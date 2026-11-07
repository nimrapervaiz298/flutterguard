import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules", ".git", "build", ".dart_tool", "dist",
  "ephemeral", "Pods", ".gradle", ".pub-cache", "coverage",
]);
export const DEFAULT_MAX_FILE_BYTES = 1_000_000;

export interface ScanOptions {
  maxFileBytes: number;
  skipDirs: ReadonlySet<string>;
}

export interface ScanStats {
  filesListed: number;
  dirsSkipped: number;
  symlinksSkipped: number;
  unreadableDirs: number;
  filesTooLarge: number;
  filesUnreadable: number;
  outsideBlocked: number;
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith(".." + path.sep);
}

// file path -> the scanner that listed it
const owners = new Map<string, ProjectScanner>();

export class ProjectScanner {
  readonly root: string;
  readonly options: ScanOptions;
  readonly stats: ScanStats = {
    filesListed: 0,
    dirsSkipped: 0,
    symlinksSkipped: 0,
    unreadableDirs: 0,
    filesTooLarge: 0,
    filesUnreadable: 0,
    outsideBlocked: 0,
  };
  private listed: string[] | null = null;
  private cache = new Map<string, string | null>();

  constructor(rootDir: string, options: Partial<ScanOptions> = {}) {
    const root = path.resolve(rootDir);
    let st: fs.Stats;
    try {
      st = fs.statSync(root);
    } catch {
      throw new Error(`Project folder not found: ${rootDir}`);
    }
    if (!st.isDirectory()) throw new Error(`Not a folder: ${rootDir}`);
    this.root = root;
    this.options = {
      maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
      skipDirs: options.skipDirs ?? DEFAULT_SKIP_DIRS,
    };
  }

  /** All files inside the project. Symlinks are never followed, so the walk cannot leave the project. */
  files(): string[] {
    if (this.listed) return this.listed;
    const out: string[] = [];
    const visit = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        this.stats.unreadableDirs++;
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isSymbolicLink()) {
          this.stats.symlinksSkipped++;
          continue;
        }
        if (e.isDirectory()) {
          if (this.options.skipDirs.has(e.name)) {
            this.stats.dirsSkipped++;
            continue;
          }
          visit(full);
        } else if (e.isFile()) {
          out.push(full);
        }
      }
    };
    visit(this.root);
    out.sort();
    this.listed = out;
    this.stats.filesListed = out.length;
    for (const f of out) owners.set(f, this);
    return out;
  }

  /** File text, or null when the file is outside the project, too large or unreadable. Never throws. */
  read(file: string): string | null {
    const abs = path.resolve(file);
    if (!isInside(this.root, abs)) {
      this.stats.outsideBlocked++;
      return null;
    }
    if (this.cache.has(abs)) return this.cache.get(abs) ?? null;
    let text: string | null = null;
    try {
      const st = fs.statSync(abs);
      if (!st.isFile()) {
        this.stats.filesUnreadable++;
      } else if (st.size > this.options.maxFileBytes) {
        this.stats.filesTooLarge++;
      } else {
        text = fs.readFileSync(abs, "utf8");
      }
    } catch {
      this.stats.filesUnreadable++;
    }
    this.cache.set(abs, text);
    return text;
  }
}

// ---------- shared access used by every check ----------
const scanners = new Map<string, ProjectScanner>();
let defaults: Partial<ScanOptions> = {};

export function configureScanner(options: Partial<ScanOptions>): void {
  defaults = { ...defaults, ...options };
  resetScanners();
}

export function resetScanners(): void {
  scanners.clear();
  owners.clear();
}

export function getScanner(dir: string): ProjectScanner {
  const key = path.resolve(dir);
  let s = scanners.get(key);
  if (!s) {
    s = new ProjectScanner(key, defaults);
    scanners.set(key, s);
  }
  return s;
}

export function walk(dir: string): string[] {
  return getScanner(dir).files();
}

/** Returns "" when the file cannot be read, so callers never crash. */
export function readText(file: string): string {
  const abs = path.resolve(file);
  const owner = owners.get(abs);
  return owner ? owner.read(abs) ?? "" : "";
}