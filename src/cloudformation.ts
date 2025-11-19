export type CfFnGetAtt = { "Fn::GetAtt": [string, string] };
export type CfRef<T = string> = { Ref: T };

type CfBase = string | CfRef | CfFnGetAtt;

export type CfSplit = {
    "Fn::Split": [CfBase, CfBase];
};

type CfArray = CfSplit;
export type CfSelect = {
    "Fn::Select": [number, CfArray];
};

export type CfString = CfBase | CfSelect;
