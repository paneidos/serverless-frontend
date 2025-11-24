import type { CfString } from "./cloudformation";

export const CachePolicies = {
    CachingDisabled: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
    CachingOptimized: "658327ea-f89d-4fab-a63d-7e88639e58f6",
    UseOriginCacheControlHeaders: "83da9c7e-98b4-4e11-a168-04f0df8e2c65",
    "UseOriginCacheControlHeaders-QueryStrings":
        "4cc15a8a-d715-48a4-82b8-cc0b614638fe",
    ServerFunctionCachePolicy: { Ref: "SiteSSRCachePolicy" },
} as const;

export const OriginRequestPolicies = {
    AllViewerExceptHostHeader: "b689b0a8-53d0-40ab-baf2-68738e2966ac",
    CORS_S3Origin: "88a5eaf4-2fd4-4709-b370-b4c650ea3fcf",
} as const;

export const ResponseHeaderPolicy = {
    SecurityHeadersPolicy: "67f7725c-6f97-4210-82d7-5512b31e9d03",
};

export const HttpMethods = {
    ReadWithoutCors: ["GET", "HEAD"],
    Read: ["GET", "HEAD", "OPTIONS"],
    ReadWrite: ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"],
} as const;

export type CloudFrontCacheBehavior = {
    PathPattern: string;
    AllowedMethods: (typeof HttpMethods)[keyof typeof HttpMethods];
    CachedMethods: (typeof HttpMethods)["Read" | "ReadWithoutCors"];
    CachePolicyId: CfString;
    Compress?: boolean;
    FunctionAssociations?: Array<{
        EventType: string;
        FunctionARN: CfString;
    }>;
    OriginRequestPolicyId: string;
    ResponseHeadersPolicyId?: string;
    SmoothStreaming?: boolean;
    TargetOriginId: string;
    ViewerProtocolPolicy: "allow-all" | "https-only" | "redirect-to-https";
};

export type DefaultCacheBehavior = Omit<CloudFrontCacheBehavior, "PathPattern">;

interface CloudFrontBaseOrigin {
    DomainName: CfString;
    Id: string;
    OriginPath?: string;
}

interface CloudFrontCustomOrigin extends CloudFrontBaseOrigin {
    CustomOriginConfig: {
        HTTPPort?: number;
        HTTPSPort?: number;
        IpAddressType?: "ipv4" | "ipv6" | "dualstack";
        OriginKeepaliveTimeout?: number;
        OriginProtocolPolicy: "http-only" | "match-viewer" | "https-only";
        OriginReadTimeout?: number;
        OriginSSLProtocols?: ("SSLv3" | "TLSv1" | "TLSv1.1" | "TLSv1.2")[];
    };
}

interface CloudFrontS3Origin extends CloudFrontBaseOrigin {
    OriginAccessControlId: CfString;
    S3OriginConfig?: {
        OriginAccessIdentity: "";
    };
}

export type CloudFrontOrigin = CloudFrontS3Origin | CloudFrontCustomOrigin;

type CloudFrontArray<T> = {
    Quantity: number;
    Items: T[];
};

type CloudFrontOriginGroup = {
    FailoverCriteria: {
        StatusCodes: CloudFrontArray<number>;
    };
    Id: string;
    Members: CloudFrontArray<{
        OriginId: string;
    }>;
    SelectionCriteria?: "default" | "media-quality-based";
};

export type CloudFrontDistributionConfig = {
    Enabled: boolean;
    HttpVersion: "http1.1" | "http2" | "http2and3" | "http3";
    PriceClass: "PriceClass_100" | "PriceClass_200" | "PriceClass_All";
    IPV6Enabled: boolean;
    DefaultRootObject?: string;
    Aliases?: string[];
    Comment?: string;
    Origins: CloudFrontOrigin[];
    OriginGroups?: CloudFrontArray<CloudFrontOriginGroup>;
    ViewerCertificate?: {
        AcmCertificateArn: string;
        MinimumProtocolVersion:
            | "SSLv3"
            | "TLSv1"
            | "TLSv1_2016"
            | "TLSv1.1_2016"
            | "TLSv1.2_2018"
            | "TLSv1.2_2019"
            | "TLSv1.2_2021"
            | "TLSv1.3_2025"
            | "TLSv1.2_2025";
        SslSupportMethod: "sni-only";
    };
    DefaultCacheBehavior: DefaultCacheBehavior;
    CacheBehaviors: CloudFrontCacheBehavior[];
};

export const ServerFunctionCachePolicyConfig = {
    Name: {
        //biome-ignore lint/suspicious/noTemplateCurlyInString: CloudFormation
        "Fn::Sub": "${AWS::StackName}-ssr",
    },
    Comment: {
        //biome-ignore lint/suspicious/noTemplateCurlyInString: CloudFormation
        "Fn::Sub": "SSR for ${AWS::StackName}",
    },
    DefaultTTL: 0,
    MinTTL: 0,
    MaxTTL: 31536000,
    ParametersInCacheKeyAndForwardedToOrigin: {
        EnableAcceptEncodingBrotli: true,
        EnableAcceptEncodingGzip: true,
        CookiesConfig: {
            CookieBehavior: "all",
        },
        HeadersConfig: {
            HeaderBehavior: "whitelist",
            Headers: ["origin", "x-forwarded-host"],
        },
        QueryStringsConfig: {
            QueryStringBehavior: "all",
        },
    },
};

const cloudfrontOrigin = (origin: CloudFrontOrigin) => origin;

export const StandardOrigins = {
    staticFiles: cloudfrontOrigin({
        Id: "StaticFiles",
        OriginAccessControlId: {
            "Fn::GetAtt": ["SiteOriginAccessControl", "Id"],
        },
        S3OriginConfig: {
            OriginAccessIdentity: "",
        },
        DomainName: {
            "Fn::GetAtt": ["SiteBucket", "RegionalDomainName"],
        },
    }),
    staticFilesFallback: cloudfrontOrigin({
        Id: "StaticFilesFallback",
        OriginAccessControlId: {
            "Fn::GetAtt": ["SiteOriginAccessControl", "Id"],
        },
        S3OriginConfig: {
            OriginAccessIdentity: "",
        },
        DomainName: {
            "Fn::GetAtt": ["SiteBucket", "RegionalDomainName"],
        },
        OriginPath: "/index.html?fallback=",
    }),
    serverFunction: cloudfrontOrigin({
        Id: "ServerFunction",
        CustomOriginConfig: {
            OriginProtocolPolicy: "https-only",
            OriginSSLProtocols: ["TLSv1.2"],
        },
        DomainName: {
            "Fn::Select": [
                2,
                {
                    "Fn::Split": [
                        "/",
                        {
                            "Fn::GetAtt": [
                                "ServerLambdaFunctionUrl",
                                "FunctionUrl",
                            ],
                        },
                    ],
                },
            ],
        },
    }),
} as const;

export function cloudfrontArray<T>(array: T[]): CloudFrontArray<T> {
    return {
        Quantity: array.length,
        Items: array,
    };
}

const cloudfrontOriginGroup = (originGroup: CloudFrontOriginGroup) =>
    originGroup;

export const StandardOriginGroups = {
    staticFilesSPA: cloudfrontOriginGroup({
        Id: "StaticFilesSPA",
        FailoverCriteria: {
            StatusCodes: cloudfrontArray([403, 404]),
        },
        Members: cloudfrontArray([
            { OriginId: StandardOrigins.staticFiles.Id },
            { OriginId: StandardOrigins.staticFilesFallback.Id },
        ]),
    }),
    staticFilesSSR: cloudfrontOriginGroup({
        Id: "StaticFilesSSR",
        FailoverCriteria: {
            StatusCodes: cloudfrontArray([403, 404]),
        },
        Members: cloudfrontArray([
            { OriginId: StandardOrigins.staticFiles.Id },
            { OriginId: StandardOrigins.serverFunction.Id },
        ]),
    }),
};

const partialCacheBehavior = (behavior: DefaultCacheBehavior) => behavior;

export const StandardCacheBehaviors = {
    staticFiles: partialCacheBehavior({
        AllowedMethods: HttpMethods.ReadWithoutCors,
        CachedMethods: HttpMethods.ReadWithoutCors,
        CachePolicyId: CachePolicies.CachingOptimized,
        OriginRequestPolicyId: OriginRequestPolicies.CORS_S3Origin,
        TargetOriginId: StandardOrigins.staticFiles.Id,
        ViewerProtocolPolicy: "redirect-to-https",
    }),
    staticFilesSPA: partialCacheBehavior({
        AllowedMethods: HttpMethods.ReadWithoutCors,
        CachedMethods: HttpMethods.ReadWithoutCors,
        CachePolicyId: CachePolicies.CachingOptimized,
        OriginRequestPolicyId: OriginRequestPolicies.CORS_S3Origin,
        TargetOriginId: StandardOriginGroups.staticFilesSPA.Id,
        ViewerProtocolPolicy: "redirect-to-https",
    }),
    staticFilesSSR: partialCacheBehavior({
        AllowedMethods: HttpMethods.ReadWithoutCors,
        CachedMethods: HttpMethods.ReadWithoutCors,
        CachePolicyId: CachePolicies.CachingOptimized,
        OriginRequestPolicyId: OriginRequestPolicies.CORS_S3Origin,
        TargetOriginId: StandardOriginGroups.staticFilesSSR.Id,
        ViewerProtocolPolicy: "redirect-to-https",
    }),
    serverFunction: partialCacheBehavior({
        AllowedMethods: HttpMethods.ReadWrite,
        CachedMethods: HttpMethods.Read,
        CachePolicyId: CachePolicies.ServerFunctionCachePolicy,
        OriginRequestPolicyId: OriginRequestPolicies.AllViewerExceptHostHeader,
        TargetOriginId: StandardOrigins.serverFunction.Id,
        ViewerProtocolPolicy: "redirect-to-https",
    }),
};

export const CloudFrontFunctions = {
    forwardHostHeader: {
        AutoPublish: true,
        FunctionCode:
            'function handler(event) { var request = event.request; request.headers["x-forwarded-host"] = request.headers.host; return request; }',
        FunctionConfig: {
            Comment: "Forward host header",
            Runtime: "cloudfront-js-2.0",
        },
        Name: { "Fn::Sub": "${AWS::StackName}-${AWS::Region}-forward-host" },
    },
} as const;
