# 噜包蛋之城 · 独立网站版

部署在 Cloudflare Pages 上，网址：https://luuegg.pages.dev

## 文件说明
- `public/`：网页本身（index.html、api.js、地图数据 geo/）
- `functions/api/[[path]].js`：后台程序（读写记录、上传照片、登录、地点搜索）
- `functions/photo/[id].js`：显示照片

## Cloudflare 里需要的设置（Pages 项目 → Settings）
| 类型 | 变量名 | 连到 |
|---|---|---|
| D1 数据库绑定 | `DB` | luuegg-db |
| R2 存储桶绑定 | `PHOTOS` | luuegg-photos |
| 加密变量（Secret） | `EDIT_PASSWORD` | 噜和蛋的编辑密码 |
| 变量（Text 或 Secret 均可） | `GOOGLE_MAPS_KEY` | Google Maps API key（可选；不填就用手绘地图） |

构建设置：Framework preset 选 None，Build command 留空，Build output directory 填 `public`。

改完设置后，要到 Deployments 里点 Retry deployment，设置才会生效。

## 安全阀
照片总量到 9GB 时会拒绝继续上传，保证不超过 R2 的 10GB 免费额度。

## Google 地图
填了 `GOOGLE_MAPS_KEY` 后，所有地图自动换成 Google 地图，「搜这个地点」也改用 Google 的地点搜索。key 需要在 Google Cloud 开启 Maps JavaScript API 和 Places API (New)，并把可用网址限制为 `https://luuegg.pages.dev/*`。网址后面加 `?nogmaps` 可以临时用回手绘地图。
