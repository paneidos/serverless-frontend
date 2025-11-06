import { spawn } from "node:child_process";
import fs, { readdir } from "node:fs/promises";
import archiver from "archiver";
import mime from "mime";
import type Serverless from "serverless";
import type Aws from "serverless/aws";
import type Plugin from "serverless/classes/Plugin";
import {
	type CloudfrontDistributionConfig,
	ServerFunctionCachePolicyConfig,
	StandardCacheBehaviors,
	StandardOrigins,
} from "./cloudfront";
import { Process } from "./process";
import {
	StandardCacheControl,
	StandardSiteBucket,
	StandardSiteBucketPolicy,
} from "./s3";

interface AwsOutput {
	OutputKey: string;
	OutputValue: string;
}

type Framework = "vite" | "nitro" | "nuxt" | "tanstack-start";

type ServerlessOutputs = {
	serviceOutputs: {
		set: (name: string, value: string) => void;
	};
};

interface FrontendConfig {
	buildCommand?: string | string[];
	framework?: Framework | null;
	ssr?: boolean;
	aliases?: string[] | string;
	certificate?: string;
	cloudfront?: {
		description?: string;
		price_class?: CloudfrontDistributionConfig["PriceClass"];
		ipv6?: boolean;
		enabled?: boolean;
		http?: CloudfrontDistributionConfig["HttpVersion"];
		ssl_version?: Exclude<
			CloudfrontDistributionConfig["ViewerCertificate"],
			undefined
		>["MinimumProtocolVersion"];
	};
}

class FrontendPlugin implements Plugin {
	commands: Plugin.Commands | undefined;
	hooks: Plugin.Hooks;
	serverless: Serverless & ServerlessOutputs;
	options: Serverless.Options;
	provider: Aws;
	log: Plugin.Logging["log"];
	progress: Plugin.Logging["progress"];

	constructor(
		serverless: Serverless & ServerlessOutputs,
		options: Serverless.Options,
		{ log, progress }: Plugin.Logging,
	) {
		this.serverless = serverless;
		this.options = options;
		this.provider = this.serverless.getProvider("aws");
		this.hooks = {};
		this.log = log;
		this.progress = progress;
		this.commands = {
			frontend: {
				commands: {
					addFunctions: { lifecycleEvents: ["addFunctions"] },
					build: { lifecycleEvents: ["build", "package"] },
					upload: { lifecycleEvents: ["upload"] },
					invalidate: { lifecycleEvents: ["invalidate"] },
				},
			},
		};

		this.hooks = {
			"before:package:initialize": () =>
				this.serverless.pluginManager.spawn("frontend:addFunctions"),
			"before:info:info": () =>
				this.serverless.pluginManager.spawn("frontend:addFunctions"),
			"after:aws:info:displayEndpoints": this.addSiteUrl.bind(this),
			"before:package:finalize": this.addResources.bind(this),
			"before:remove:remove": this.emptySiteBucket.bind(this),
			"before:package:createDeploymentArtifacts": () =>
				this.serverless.pluginManager.spawn("frontend:build"),
			"before:package:function:package": () =>
				this.serverless.pluginManager.spawn("frontend:build"),
			"after:deploy:deploy": () =>
				this.serverless.pluginManager.spawn("frontend:upload"),
			"frontend:addFunctions:addFunctions": this.addFunctions.bind(this),
			"frontend:build:build": this.build.bind(this),
			"frontend:build:package": this.packageFunctions.bind(this),
			"frontend:upload:upload": this.uploadAssets.bind(this),
			"frontend:invalidate:invalidate": this.createInvalidation.bind(this),
		};
	}

	get customConfig(): FrontendConfig {
		this.serverless.service.custom ??= {};
		this.serverless.service.custom.frontend ??= {};
		return this.serverless.service.custom.frontend;
	}

	async _hasFile(name: string): Promise<boolean> {
		try {
			const stat = await fs.stat(name);
			return stat.isFile();
		} catch (err) {
			if (!String(err).includes("ENOENT")) {
				console.error(err);
			}
			return false;
		}
	}

	async detectFramework(): Promise<Framework | null> {
		if (this.customConfig.framework !== undefined) {
			return this.customConfig.framework;
		}

		const hasNuxtConfig = await this._hasFile("nuxt.config.ts");

		const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
		this.log.info(JSON.stringify(packageJson, null, 2));
		if ("@tanstack/react-start" in packageJson.dependencies) {
			this.log.info("Detected TanStack Start");
			this.customConfig.framework = "tanstack-start";
		} else if ("nuxt" in packageJson.dependencies || hasNuxtConfig) {
			this.log.info("Detected Nuxt");
			this.customConfig.framework = "nuxt";
		} else if ("nitro" in packageJson.dependencies) {
			this.log.info("Detected Nitro-based frontend");
			this.customConfig.framework = "nitro";
		} else if (
			"vite" in packageJson.dependencies ||
			"vite" in packageJson.devDependencies
		) {
			this.log.info("Detected Vite-based frontend");
			this.customConfig.framework = "vite";
		} else {
			this.customConfig.framework = null;
		}

		return this.customConfig.framework;
	}

	async getStackOutputs(): Promise<Record<string, string>> {
		const stackName = this.provider.naming.getStackName();
		const result = await this.provider.request(
			"CloudFormation",
			"describeStacks",
			{ StackName: stackName },
		);
		if (result.Stacks.length === 0) {
			return {};
		}
		return result.Stacks[0].Outputs.reduce(
			(obj: Record<string, string>, output: AwsOutput) => {
				obj[output.OutputKey] = output.OutputValue;
				return obj;
			},
			{} satisfies Record<string, string>,
		);
	}

	addResource(logicalId: string, config: Aws.CloudFormationResource) {
		this.serverless.service.provider.compiledCloudFormationTemplate.Resources[
			logicalId
		] = config;
	}

	addOutput(logicalId: string, config: Aws.Output) {
		this.serverless.service.provider.compiledCloudFormationTemplate.Outputs ||=
			{};
		this.serverless.service.provider.compiledCloudFormationTemplate.Outputs[
			logicalId
		] = config;
	}

	async addSiteUrl() {
		const framework = await this.detectFramework();
		if (framework == null) {
			return;
		}
		const outputs = await this.getStackOutputs();
		if (outputs.SiteURL !== undefined) {
			this.serverless.serviceOutputs.set("site", outputs.SiteURL);
		}
	}

	async buildCommand(): Promise<string | string[]> {
		if (this.customConfig.buildCommand !== undefined) {
			return this.customConfig.buildCommand;
		}
		const isYarn = await this._hasFile("yarn.lock");
		const isPnpm = await this._hasFile("pnpm-lock.json");

		const packageManager = isYarn ? "yarn" : isPnpm ? "pnpm" : "npm";

		const framework = await this.detectFramework();

		switch (framework) {
			case "tanstack-start":
			case "nuxt":
			case "nitro":
			case "vite":
				return [packageManager, "build"];
		}

		throw new Error(`Unsupported build command for ${framework}`);
	}

	async build() {
		const buildProgress = this.progress.get("build");
		buildProgress.update("Building frontend");
		let command = await this.buildCommand();
		if (typeof command === "string") {
			command = command.split(" ");
			buildProgress.update(`Building frontend: ${command}`);
		} else {
			buildProgress.update(`Building frontend: ${command.join(" ")}`);
		}
		const cmd = command.shift();
		if (cmd === undefined) {
			throw new Error("No build command given");
		}
		const process = new Process(spawn(cmd, command));
		const exitCode = await process.exitCode;
		buildProgress.remove();
		if (exitCode !== 0) {
			throw new Error(`Build exited with code ${exitCode}`);
		}
	}

	async addBucketResources() {
		this.addResource("SiteBucket", {
			Type: "AWS::S3::Bucket",
			Properties: StandardSiteBucket,
		});
		this.addResource("SiteBucketPolicy", {
			Type: "AWS::S3::BucketPolicy",
			Properties: StandardSiteBucketPolicy,
		});
		this.addOutput("SiteBucketName", {
			Description: "Name of the site bucket",
			Value: { Ref: "SiteBucket" },
		});
	}

	async addCloudfrontResources() {
		this.addResource("SiteOriginAccessControl", {
			Type: "AWS::CloudFront::OriginAccessControl",
			Properties: {
				OriginAccessControlConfig: {
					Description: {
						//biome-ignore lint/suspicious/noTemplateCurlyInString: CloudFormation
						"Fn::Sub": "Used by ${AWS::StackName}-${AWS::Region}",
					},
					Name: {
						//biome-ignore lint/suspicious/noTemplateCurlyInString: CloudFormation
						"Fn::Sub": "${AWS::StackName}-${AWS::Region}",
					},
					OriginAccessControlOriginType: "s3",
					SigningBehavior: "always",
					SigningProtocol: "sigv4",
				},
			},
		});
		const config = this.customConfig.cloudfront ?? {};
		const distributionConfig: Partial<CloudfrontDistributionConfig> = {
			Enabled: config.enabled ?? true,
			HttpVersion: config.http ?? "http2and3",
			PriceClass: config.price_class ?? "PriceClass_100",
			IPV6Enabled: config.ipv6 ?? true,
			Comment: config.description,
		};
		const aliases = this.customConfig.aliases;
		const certificate = this.customConfig.certificate;
		if (aliases && certificate) {
			if (typeof aliases === "string") {
				distributionConfig.Aliases = aliases.split(",");
			} else {
				distributionConfig.Aliases = aliases;
			}
			distributionConfig.ViewerCertificate = {
				AcmCertificateArn: certificate,
				MinimumProtocolVersion: config.ssl_version ?? "TLSv1.2_2021",
				SslSupportMethod: "sni-only",
			};
		}

		const framework = await this.detectFramework();
		switch (framework) {
			case "nuxt":
			case "nitro":
			case "tanstack-start": {
				distributionConfig.Origins = [
					StandardOrigins.staticFiles,
					StandardOrigins.serverFunction,
				];
				distributionConfig.DefaultCacheBehavior =
					StandardCacheBehaviors.serverFunction;
				distributionConfig.CacheBehaviors = [];
				const publicDirectory = ".output/public";
				const files = await readdir(publicDirectory, { withFileTypes: true });
				for (const file of files) {
					if (file.isFile() || file.isDirectory()) {
						distributionConfig.CacheBehaviors.push({
							PathPattern: file.name + (file.isDirectory() ? "/*" : ""),
							...StandardCacheBehaviors.staticFiles,
						});
					}
				}
				break;
			}
			case "vite":
				distributionConfig.Origins = [
					StandardOrigins.staticFiles,
					StandardOrigins.staticFilesFallback,
				];
				distributionConfig.OriginGroups = {
					Quantity: 1,
					Items: [
						{
							Id: "StaticFilesWithFallback",
							FailoverCriteria: {
								StatusCodes: {
									Quantity: 2,
									Items: [403, 404],
								},
							},
							Members: {
								Quantity: 2,
								Items: [
									{ OriginId: "StaticFiles" },
									{ OriginId: "StaticFilesFallback" },
								],
							},
						},
					],
				};
				distributionConfig.DefaultCacheBehavior =
					StandardCacheBehaviors.staticFilesWithFallback;
				break;
		}
		this.addResource("SiteSSRCachePolicy", {
			Type: "AWS::CloudFront::CachePolicy",
			Properties: {
				CachePolicyConfig: ServerFunctionCachePolicyConfig,
			},
		});
		this.addResource("SiteDistribution", {
			Type: "AWS::CloudFront::Distribution",
			Properties: {
				DistributionConfig: distributionConfig,
			},
		});
		this.addOutput("SiteCloudFrontDomain", {
			Description: "URL of the CloudFront distribution",
			Value: { "Fn::GetAtt": ["SiteDistribution", "DomainName"] },
		});
		this.addOutput("SiteURL", {
			Description: "URL of the CloudFront distribution",
			//biome-ignore lint/suspicious/noTemplateCurlyInString: CloudFormation
			Value: { "Fn::Sub": "https://${SiteDistribution.DomainName}" },
		});
	}

	async addResources() {
		await this.addBucketResources();
		await this.addCloudfrontResources();
	}

	async addNitroFunction() {
		const service = this.serverless.service.service;
		const stage = this.provider.getStage();
		const functions = {
			server: {
				name: `${service}-${stage}-server`,
				handler: "server/index.handler",
				timeout: 10,
				memorySize: 1024,
				events: [],
				url: true,
				package: {
					individually: true,
					artifact: ".serverless/frontend-function.zip",
				},
			},
		};

		this.serverless.service.functions.server = functions.server;
	}

	async addFunctions() {
		switch (await this.detectFramework()) {
			case "tanstack-start":
			case "nuxt":
			case "nitro":
				this.addNitroFunction();
		}
	}

	async packageFunction(
		file: string,
		cwd: string,
		pattern: string | string[] = ["*", "**/*"],
	) {
		const archive = archiver("zip", {});
		const fd = await fs.open(file, "w");
		const output = fd.createWriteStream();
		const promise = new Promise((resolve, reject) => {
			output.on("close", () => {
				resolve(true);
			});
			archive.on("error", reject);
		});
		archive.pipe(output);
		for (const patternElement of pattern) {
			archive.glob(patternElement, { cwd });
		}
		archive.finalize();
		await promise;
	}

	async packageFunctions() {
		const packageProgress = this.progress.get("package-functions");
		packageProgress.update("Packaging functions");
		switch (await this.detectFramework()) {
			case "tanstack-start":
			case "nuxt":
			case "nitro":
				await this.packageFunction(
					".serverless/frontend-function.zip",
					".output",
				);
		}
		packageProgress.remove();
	}

	async uploadAssets() {
		const uploadProgress = this.progress.get("upload");
		uploadProgress.update("Uploading frontend");
		const outputs = await this.getStackOutputs();
		const bucketName = outputs.SiteBucketName;
		const framework = await this.detectFramework();

		const directory =
			framework === "nitro" ||
			framework === "tanstack-start" ||
			framework === "nuxt"
				? ".output/public"
				: "dist";
		const immutableAssets =
			framework === "nuxt"
				? /^_nuxt\//
				: framework === "tanstack-start"
					? /^assets\//
					: framework === "nitro" || framework === "vite"
						? /^assets\//
						: /^$/;
		const files = await fs.readdir(directory, {
			recursive: true,
			withFileTypes: true,
		});
		const cacheControls = StandardCacheControl;
		for (const file of files) {
			if (!file.isFile()) {
				continue;
			}
			const fullPath = `${file.parentPath}/${file.name}`;
			const baseKey = fullPath.substring(directory.length + 1);
			const targetKey = baseKey;
			const cacheControl = baseKey.match(immutableAssets)
				? cacheControls.immutable
				: cacheControls.normal;
			const params = {
				Body: await fs.readFile(fullPath),
				Bucket: bucketName,
				Key: targetKey,
				CacheControl: cacheControl,
				ContentType: mime.getType(fullPath),
			};
			await this.provider.request("S3", "putObject", params);
		}
		uploadProgress.remove();
	}

	async createInvalidation() {
		const invalidateProgress = this.progress.get("invalidate");
		invalidateProgress.update("Creating invalidation");
		const stackName = this.provider.naming.getStackName();
		const result: {
			StackResources: Array<{
				LogicalResourceId: string;
				PhysicalResourceId: string;
			}>;
		} = await this.provider.request(
			"CloudFormation",
			"describeStackResources",
			{ StackName: stackName },
		);
		const distribution = result.StackResources.find(
			(resource) => resource.LogicalResourceId === "SiteDistribution",
		);
		const distributionId = distribution?.PhysicalResourceId;
		if (distributionId != null) {
			await this.provider.request("CloudFront", "createInvalidation", {
				DistributionId: distributionId,
				InvalidationBatch: {
					CallerReference: new Date().toISOString(),
					Paths: {
						Quantity: 1,
						Items: ["/*"],
					},
				},
			});
		}
		invalidateProgress.remove();
	}

	async listObjectsV2(bucketName: string): Promise<Array<{ Key: string }>> {
		const objectsInBucket: { Key: string }[] = [];

		let result: { Contents: { Key: string }[] } | undefined;
		try {
			result = await this.provider.request("S3", "listObjectsV2", {
				Bucket: bucketName,
				Prefix: "",
			});
		} catch (err) {
			if (
				err instanceof Error &&
				"code" in err &&
				err.code === "AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED"
			) {
				throw new this.serverless.classes.Error(
					`Could not list objects in the deployment bucket. Make sure you have sufficient permissions to access it. [${err.code}]`,
				);
			}
			throw err;
		}

		if (result) {
			result.Contents.forEach((object) => {
				objectsInBucket.push({
					Key: object.Key,
				});
			});
		}
		return objectsInBucket;
	}

	async listObjects(bucketName: string) {
		return this.listObjectsV2(bucketName);
	}

	async deleteObjects(bucketName: string) {
		const objectsInBucket = await this.listObjects(bucketName);
		if (objectsInBucket.length) {
			const data = await this.provider.request("S3", "deleteObjects", {
				Bucket: bucketName,
				Delete: {
					Objects: objectsInBucket,
				},
			});
			if (data?.Errors?.length) {
				const firstErrorCode = data.Errors[0].Code;

				if (firstErrorCode === "AccessDenied") {
					throw new this.serverless.classes.Error(
						`Could not empty the S3 deployment bucket (${bucketName}). Make sure that you have permissions that allow S3 objects deletion. First encountered S3 error code: ${firstErrorCode} [CANNOT_DELETE_S3_OBJECTS_ACCESS_DENIED]`,
					);
				}

				throw new this.serverless.classes.Error(
					`Could not empty the S3 deployment bucket (${bucketName}). First encountered S3 error code: ${firstErrorCode} [CANNOT_DELETE_S3_OBJECTS_GENERIC]`,
				);
			}
		}
	}

	async emptySiteBucket() {
		const stackName = this.provider.naming.getStackName();
		const result: {
			StackResources: Array<{
				LogicalResourceId: string;
				PhysicalResourceId: string;
			}>;
		} = await this.provider.request(
			"CloudFormation",
			"describeStackResources",
			{ StackName: stackName },
		);
		const siteBucket = result.StackResources.find(
			(resource) => resource.LogicalResourceId === "SiteBucket",
		);
		const bucketName = siteBucket?.PhysicalResourceId;
		if (bucketName != null) {
			await this.deleteObjects(bucketName);
		} else {
			this.log.info(
				"Site S3 bucket not found. Skipping S3 bucket objects removal",
			);
		}
	}
}

export default FrontendPlugin;
