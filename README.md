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
  runtime: nodejs22.x
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

## Specify framework

You can manually specify the framework to use:

```yaml
custom:
  frontend:
    framework: nitro  # nuxt | tanstack-start | nitro | vite
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

## SPA Mode

In SPA mode, all requests are routed to S3, but using origin groups and
a specially crafted origin, any 404/403 from S3 will result in serving the index.html.
By specifying a origin path of `index.html?fallback=`, the original path becomes a query parameter
and index.html is served instead.

# Roadmap

- Customisation of functions/resources

# Why not use SST?

SST is a great framework, but I didn't want to add Terraform to my tech stack.
Using Serverless (almost) everything is handled by CloudFormation.
It's a matter of preference, so I made something that works with Serverless.

# Acknowledgments

This project is built on these awesome projects:

- [Serverless Framework](https://serverless.com)
