import process from "node:process";

process.stdout.write("12345678\r\n123456789\n");
process.stdout.write("🙂🙂🙂\n");
process.stdout.write("x".repeat(200000));
process.stdout.write("\nshort\n");
process.stderr.write("abcdefghijk");
