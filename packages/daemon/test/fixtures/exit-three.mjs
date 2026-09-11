import process from "node:process";

process.stdout.write("failed\n");
process.exitCode = 3;
