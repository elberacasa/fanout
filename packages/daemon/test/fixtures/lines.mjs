import process from "node:process";

process.stdout.write("first\r\nsecond\n\nlast");
process.stderr.write("warning\r\nfinal warning");
