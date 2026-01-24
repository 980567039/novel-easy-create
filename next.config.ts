import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // 开启重写规则，把 /api/local 转发到 LM Studio
  async rewrites() {
    return [
      {
        source: '/api/local/:path*', // 前端请求这个路径
        destination: 'http://localhost:1234/v1/:path*', // 转发给 LM Studio
      },
      // === 新增：ComfyUI 代理 ===
      {
        source: '/api/comfy/:path*',
        // ComfyUI 默认端口是 8188，请根据你实际情况修改
        destination: 'http://127.0.0.1:8188/:path*', 
      },
    ];
  },
};

export default nextConfig;
