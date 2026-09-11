import process from "node:process";

process.stdout.write(
  `${JSON.stringify({ env: process.env, cwd: process.cwd(), args: process.argv.slice(2) })}\n`,
);
