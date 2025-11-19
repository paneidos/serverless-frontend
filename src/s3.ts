export const StandardSiteBucket = {
    BucketEncryption: {
        ServerSideEncryptionConfiguration: [
            {
                ServerSideEncryptionByDefault: {
                    SSEAlgorithm: "AES256",
                },
            },
        ],
    },
};

export const StandardSiteBucketPolicy = {
    Bucket: { Ref: "SiteBucket" },
    PolicyDocument: {
        Id: "BucketPolicy",
        Version: "2012-10-17",
        Statement: [
            {
                Sid: "PublicReadForCloudFront",
                Effect: "Allow",
                Principal: {
                    Service: "cloudfront.amazonaws.com",
                },
                Action: ["s3:GetObject", "s3:ListBucket"],
                Resource: [
                    {
                        //biome-ignore lint/suspicious/noTemplateCurlyInString: CloudFormation
                        "Fn::Sub": "${SiteBucket.Arn}/*",
                    },
                    {
                        "Fn::GetAtt": ["SiteBucket", "Arn"],
                    },
                ],
                Condition: {
                    StringEquals: {
                        "AWS:SourceArn": {
                            "Fn::Sub":
                                //biome-ignore lint/suspicious/noTemplateCurlyInString: CloudFormation
                                "arn:aws:cloudfront::${AWS::AccountId}:distribution/${SiteDistribution}",
                        },
                    },
                },
            },
        ],
    },
};

export const StandardCacheControl = {
    normal: "public,max-age=0,s-maxage=86400,stale-while-revalidate=8640",
    immutable: "public,max-age=31536000,immutable",
};
