const HOST = 'https://push2.eastmoney.com'

// 涨跌幅榜字段：代码/名称/现价/涨跌幅/涨跌额/成交量/成交额/振幅/换手/市场id
const LIST_FIELDS = 'f2,f3,f4,f5,f6,f7,f8,f12,f13,f14'
// 全 A 股市场过滤（沪深京主板/创业/科创/北交）
const ALL_A = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048'

const RANKING_FID = {
  up: { fid: 'f3', po: 1 },        // 涨幅降序
  down: { fid: 'f3', po: 0 },      // 涨幅升序 = 跌幅榜
  amplitude: { fid: 'f7', po: 1 }, // 振幅降序
  turnover: { fid: 'f8', po: 1 },  // 换手降序
}

export function rankingUrl({ type, limit = 50 }) {
  const { fid, po } = RANKING_FID[type] ?? RANKING_FID.up
  const q = new URLSearchParams({
    pn: '1', pz: String(limit), po: String(po), np: '1',
    fltt: '2', invt: '2', fid, fs: ALL_A, fields: LIST_FIELDS,
  })
  return `${HOST}/api/qt/clist/get?${q}`
}

export function overviewUrl() {
  // 上证指数 1.000001 / 深证成指 0.399001 / 创业板指 0.399006
  const q = new URLSearchParams({
    fields: 'f2,f3,f4,f12,f13,f14',
    secids: '1.000001,0.399001,0.399006',
  })
  return `${HOST}/api/qt/ulist.np/get?${q}`
}

export function sectorsUrl({ type }) {
  const t = type === 'concept' ? 't:3' : 't:2' // 行业 t:2 / 概念 t:3
  const q = new URLSearchParams({
    pn: '1', pz: '50', po: '1', np: '1', fltt: '2', invt: '2', fid: 'f3',
    fs: `m:90+${t}`,
    // 板块字段：代码/名称/涨跌幅/涨跌额/换手 + 领涨股名 f128
    fields: 'f2,f3,f4,f8,f12,f13,f14,f128',
  })
  return `${HOST}/api/qt/clist/get?${q}`
}

export function sectorStocksUrl({ boardCode, limit = 30 }) {
  const q = new URLSearchParams({
    pn: '1', pz: String(limit), po: '1', np: '1', fltt: '2', invt: '2', fid: 'f3',
    fs: `b:${boardCode}+f:!50`,
    fields: LIST_FIELDS,
  })
  return `${HOST}/api/qt/clist/get?${q}`
}

export function timelineUrl({ secid }) {
  const q = new URLSearchParams({
    secid,
    fields1: 'f1,f2,f3,f7',
    fields2: 'f51,f53,f56,f58', // 时间/价格/成交量/均价
    ndays: '1', iscr: '0',
  })
  return `${HOST}/api/qt/stock/trends2/get?${q}`
}

export function toSecid({ code, marketId }) {
  if (marketId === 0 || marketId === 1) return `${marketId}.${code}`
  const sh = /^[695]/.test(code)
  return `${sh ? 1 : 0}.${code}`
}
