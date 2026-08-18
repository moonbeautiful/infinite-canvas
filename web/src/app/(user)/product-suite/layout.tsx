import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
    title: "商品营销图 Agent",
    description: "上传商品原图，自动生成完整营销套图",
};

export default function ProductSuiteLayout({ children }: { children: ReactNode }) {
    return children;
}
