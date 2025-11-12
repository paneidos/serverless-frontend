import type { spawn } from "node:child_process";

export class Process {
	process: ReturnType<typeof spawn>;
	stdout: string;
	stderr: string;
	exitCode: Promise<number>;

	constructor(process: ReturnType<typeof spawn>) {
		this.process = process;
		this.stdout = "";
		this.stderr = "";
		this.exitCode = new Promise((resolve, _reject) => {
			this.process.on("close", (exitCode: number) => {
				if (exitCode !== 0) {
					console.error(this.stdout);
					console.error(this.stderr);
				}
				resolve(exitCode);
			});
		});
		this.process.stdout?.on("data", (data: string) => {
			this.stdout += data.toString();
		});
		this.process.stderr?.on("data", (data: string) => {
			this.stderr += data.toString();
		});
	}
}
