# A 股全市场实时盯盘网页

全市场扫描盯盘：顶部概览 + 涨跌幅榜 + 板块异动 + 板块下钻 + 个股分时。数据来自东方财富免费接口，仅供参考，不构成投资建议。

## 开发

```bash
# 终端 1：后端
cd server && npm install && npm run dev
# 终端 2：前端（带 /api 代理）
cd web && npm install && npm run dev
```

## 部署（单进程，内网分享）

```bash
cd web && npm install && npm run build      # 产出 web/dist
cd ../server && npm install
TZ=Asia/Shanghai PORT=3000 npm start         # 浏览器开 http://<本机IP>:3000
```

## 测试

```bash
cd server && npm test    # 后端
cd web && npm test       # 前端
```
