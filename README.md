# Serverless Frontend

Use [Serverless 3.x](https://serverless.com) (or [osls](https://github.com/oss-serverless/serverless)) to deploy your frontend app to AWS.

# Installation

Add this package to your project, along with Serverless
```
yarn add --dev serverless-frontend
# OR
npm install --save-dev serverless-frontend
```

Create a `serverless.yml` file with at least the bare minimum:
```yaml
frameworkVersion: "^3"
service: my-tanstack-start-app
provider:
  name: aws
  region: eu-central-1
  runtime: nodejs24.x
plugins:
  - serverless-frontend
```

Deploy using
```bash
yarn serverless deploy --stage dev
# OR
npm exec -- serverless deploy --stage dev
```

If you're using TanStack Start, Nuxt or a Vite project,
the configuration will be automatically detected.
The plugin detects your package manager based on the lock file present.

# Customisation

## Custom build command

Specify your command as an array, or a string.
If you specify a string, it'll split on spaces.

```yaml
custom:
  frontend:
    buildCommand: [yarn, build]
```

### Set environment variables for build

When building for Nitro, Nuxt or TanStack Start, the plugin adds two variables to the build environment:
- `NITRO_PRESET=aws-lambda`
- `SERVER_PRESET=aws-lambda`

If you need to override these or provide more variables, you can specify your own in the config:

```yaml
custom:
  frontend:
    buildEnvironment:
      VITE_TITLE: "My App"
```

These variables are usually available at build time using `import.meta.env.VARIABLE_NAME`, 
but only if the variable name has a specific prefix: `VITE_` for Vite, `NUXT_` for Nuxt, etc.

## SSR environment variables

To set environment variables for the SSR Lambda function,
you can use the `ssrEnvironment` option:

```yaml
custom:
  frontend:
    ssrEnvironment:
      API_URL: https://my-api.example.com/api/v1/
```

These variables are usually available at runtime on the server side using `process.env.VARIABLE_NAME`.

## Specify framework

You can manually specify the framework to use:

```yaml
custom:
  frontend:
    framework: nitro  # nuxt | tanstack-start | nitro | vite
```

## Host header

Because the SSR lambda function is behind CloudFront, it'll have a different host header.
In particular, it'll be the one used for the Lambda Function URL.
Therefore, the default configuration forwards the host header from CloudFront to the Lambda in the `X-Forwarded-Host` header.
If you're not using this header in your app, you can disable this behaviour:

```yaml
custom:
  frontend:
    ssrForwardHost: false
```

If you do want to use the `X-Forwarded-Host` header, make sure to read it in your app.
Nitro-based apps can read it automatically in the `getRequestUrl` function by specifying the appropriate options:

### Nuxt
```typescript
getRequestURL(event, { xForwardedHost: true })
```

### TanStack Start

```typescript
import { getRequestUrl } from "@tanstack/react-start/server"

getRequestUrl({ xForwardedHost: true })
```

## Custom domain name

To assign a custom domain to your CloudFront distribution,
you need to request a certificate in the us-east-1 region.
Once that is issued, you can assign the ARN and domains to
the deployed CloudFront distribution by adding the following to
`serverless.yml`:

```yaml
custom:
  frontend:
    aliases: ...  # Specify the domains you want to assign to CloudFront as a comma-separated string or array
    # Examples:
    # aliases: primary.tld
    # aliases: primary.tld,www.primary.tld
    # aliases: [primary.tld, www.primary.tld]
    # aliases: !Ref MyDomainParameter
    certificate: ...  # Specify the ARN of the certificate to assign to CloudFront
```

Tip: you can use Serverless Compose to deploy the certificate to us-east-1,
and deploy the app to another region.

## Streaming

Streaming is experimental and can be enabled by setting `streaming` to `true` in the config:

```yaml
custom:
  frontend:
    streaming: true
```

## CloudFront distribution configuration
By default, the plugin configures CloudFront with a set of reasonable defaults for a frontend app.
However, you can provide your own CloudFront configuration to override the defaults:
```yaml
custom:
  frontend:
    cloudfront:
      description: string;
      price_class: PriceClass_100 | PriceClass_200 | PriceClass_All
      ipv6: boolean
      enabled: boolean
      http: http1.1 | http2 | http2and3 | http3
      ssl_version: SSLv3 | TLSv1 | TLSv1_2016 | TLSv1.1_2016 | TLSv1.2_2018 | TLSv1.2_2019 | TLSv1.2_2021 | TLSv1.3_2025 | TLSv1.2_2025
      extraCacheBehaviors: Array<CacheBehavior>
      extraOrigins: Array<Origin>
      extraOriginGroups: Array<OriginGroup>  # Note: do not provide the wrapping structure usually required by CloudFormation, just the inner array of origin groups, as the plugin will handle the rest.
```

# Features

- SSR mode (Nitro/Nuxt/TanStack Start)
- SPA mode (Vite without SSR)

# Architecture

This package will deploy several resources to your AWS account,
which for small projects should all fall in the free tier.

- S3 bucket for assets
- Lambda for the server part
- CloudFront distribution

## SSR Mode

In SSR mode, this plugin configures the /assets (or /_nuxt for Nuxt) path to
serve static assets from S3, and all other requests are routed to the Lambda function.
Using origin groups, any 404 for the assets will also be routed to the Lambda.

### Options
```yaml
custom:
  frontend:
    ssrTimeout: number  # in seconds, default 30
    ssrMemorySize: number  # in MB, default 1024
    ssrRuntime: nodejs24.x  # defaults to provider default
    ssrArchitecture: x86_64 | arm64 # defaults to provider default
    ssrProvisionedConcurrency: number # defaults to provider default, which is usually 0 (no provisioned concurrency)
    ssrReservedConcurrency: number # defaults to provider default, which is usually unreserved
    ssrTracing: Active | PassThrough # defaults to provider default, which is usually PassThrough
```

## SPA Mode

In SPA mode, all requests are routed to S3, but using origin groups and
a specially crafted origin, any 404/403 from S3 will result in serving the index.html.
By specifying a origin path of `index.html?fallback=`, the original path becomes a query parameter
and index.html is served instead.

# Roadmap

- Customisation of functions/resources
- Update frontend bucket using a custom resource
- Cleanup of old frontend resources

# Why not use SST?

SST is a great framework, but I didn't want to add Terraform to my tech stack.
Using Serverless (almost) everything is handled by CloudFormation.
It's a matter of preference, so I made something that works with Serverless.

# Acknowledgments

This project is built on these awesome projects:

- [Serverless Framework](https://serverless.com)
