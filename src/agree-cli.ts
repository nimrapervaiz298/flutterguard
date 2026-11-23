import type { Command } from "commander";
import fs from "node:fs";
import { agreement, formatAgreement, parseAnswers } from "./agree";
import type { KeyEntry } from "./agree";

export function registerAgree(program: Command): void {
  program
    .command("agree <key> <sheet>")
    .description("compare a reviewer's answered sheet with the key (benchmark/review-key.json)")
    .action((keyFile: string, sheetFile: string) => {
      try {
        const key = JSON.parse(fs.readFileSync(keyFile, "utf8")) as KeyEntry[];
        const answers = parseAnswers(fs.readFileSync(sheetFile, "utf8"));
        console.log(formatAgreement(agreement(key, answers)));
      } catch (e) {
        console.error(`Error: ${(e as Error).message}`);
        process.exitCode = 2;
      }
    });
}
