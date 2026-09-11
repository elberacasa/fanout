import process from "node:process";
import { setTimeout } from "node:timers";
import { Buffer } from "node:buffer";

const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
process.stdout.write("fir");
process.stderr.write("war");
await pause();
process.stdout.write("st\r");
process.stderr.write("ning\r");
await pause();
process.stdout.write("\nsecond\nlast");
process.stderr.write("\nend");
const unicode = Buffer.from("🙂é");
process.stdout.write(unicode.subarray(0, 2));
await pause();
process.stdout.write(unicode.subarray(2));
