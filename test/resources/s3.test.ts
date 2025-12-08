import * as path from "node:path";
import { describe, expect, it } from "@jest/globals";
import Serverless from "serverless";
import type Plugin from "serverless/classes/Plugin";
import FrontendPlugin from "../../src/index";

async function slsProject(name: string): Promise<Serverless> {
    const sls = new Serverless({
        serviceDir: path.resolve(__dirname, "../projects/", name),
        configurationFilename: "serverless.yml",
        configuration: {
            service: "nitro-test",
            provider: {
                name: "aws",
            },
            custom: {
                frontend: {
                    framework: "nitro",
                    buildCommand: ["true"],
                },
            },
        },
        commands: [],
        options: {},
        log: {
            info: () => {},
        },
    });
    await sls.init();
    sls.pluginManager.addPlugin(
        FrontendPlugin as unknown as Plugin.PluginStatic,
    );
    return sls;
}

describe("the plugin", () => {
    it("is registered", async () => {
        const project = await slsProject("nitro");
        expect(project.pluginManager.plugins[0]).not.toBeNull();
    });

    it("create S3 resources", async () => {
        const project = await slsProject("nitro");
        const plugin = project.pluginManager.plugins[0] as FrontendPlugin;
        await project.pluginManager.spawn("package");
        expect(
            project.service.provider.compiledCloudFormationTemplate.Resources,
        ).toHaveProperty("SiteBucket");
    });
});
