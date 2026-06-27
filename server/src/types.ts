export interface FileMeta {
  name: string
  path: string
  size: number
}

export interface RedeemCodeEntry {
  used: boolean
}

export interface RedeemCodesData {
  codes: Record<string, RedeemCodeEntry | boolean>
}

export interface ItemsData {
  items: string[]
}

export interface StateData {
  redeem_codes?: RedeemCodesData
  items?: ItemsData
  [key: string]: unknown
}

export interface AppConfig {
  filesRoot: string | null
  adminPassword: string
  staticDir: string
}