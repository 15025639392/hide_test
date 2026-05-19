# 气压计爬升验收 Web

本项目是一个本地验收工具，用于导入多台设备导出的 session 目录，自动计算同一路线、
同一时间下的 BAROMETER 累计爬升一致性。

## 运行

```bash
cd acceptance-web
npm run dev
```

默认地址：

```text
http://localhost:4173
```

## 输入

第一版读取目录内所有路径末尾为 `session.json` 的文件；也可以手动选择多个
`session.json`。文件要求至少包含：

```text
sessionId
strategyVersion
deviceManufacturer
deviceBrand
deviceModel
deviceName
androidSdkInt
selectedAscentSource
barometerTotalAscentMeters
barometerAscentSampleCount
barometerAscentRejectedSampleCount
completionState
integrityState
```

每次验收默认就是同一批次、同一路线、同一算法；页面不再要求补录这些信息。
设备组合会根据 `deviceBrand`、`deviceManufacturer`、`deviceModel`、`deviceName`
自动识别。

## 判定

- 同型号：PASS `<= 8%`，REVIEW `<= 12%`
- 同品牌不同型号：PASS `<= 12%`，REVIEW `<= 15%`
- 不同品牌同算法：PASS `<= 12%`，REVIEW `<= 18%`
- 未知设备：参考 PASS `<= 12%` / REVIEW `<= 18%`，但批次最高只给 REVIEW

低爬升路线优先使用绝对差：

- `< 50m`: `<= 15m`
- `50m - 100m`: `<= 20m`
- `100m - 300m`: `<= 25m`

## 测试

```bash
npm test
```
