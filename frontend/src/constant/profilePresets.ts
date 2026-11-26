import { RulesetFormat, RulesetType } from '@/enums/kernel'

export interface ServiceRulesetPreset {
  id: string
  tag: string
  labelKey: string
  category: 'ai' | 'media' | 'dev' | 'social' | 'region' | 'system'
  url: string
  format: RulesetFormat
  type: RulesetType.Remote
}

const GEO_BASE = 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/geo'

export const CommonServiceRulesetPresets: ServiceRulesetPreset[] = [
  {
    id: 'preset-openai',
    tag: 'GeoSite-OpenAI',
    labelKey: 'profileSimple.services.openai',
    category: 'ai',
    url: `${GEO_BASE}/geosite/openai.srs`,
    format: RulesetFormat.Binary,
    type: RulesetType.Remote,
  },
  {
    id: 'preset-anthropic',
    tag: 'GeoSite-Anthropic',
    labelKey: 'profileSimple.services.anthropic',
    category: 'ai',
    url: `${GEO_BASE}/geosite/anthropic.srs`,
    format: RulesetFormat.Binary,
    type: RulesetType.Remote,
  },
  {
    id: 'preset-ai-non-cn',
    tag: 'GeoSite-AI-!CN',
    labelKey: 'profileSimple.services.ai',
    category: 'ai',
    url: `${GEO_BASE}/geosite/category-ai-!cn.srs`,
    format: RulesetFormat.Binary,
    type: RulesetType.Remote,
  },
  {
    id: 'preset-youtube',
    tag: 'GeoSite-YouTube',
    labelKey: 'profileSimple.services.youtube',
    category: 'media',
    url: `${GEO_BASE}/geosite/youtube.srs`,
    format: RulesetFormat.Binary,
    type: RulesetType.Remote,
  },
  {
    id: 'preset-netflix',
    tag: 'GeoSite-Netflix',
    labelKey: 'profileSimple.services.netflix',
    category: 'media',
    url: `${GEO_BASE}/geosite/netflix.srs`,
    format: RulesetFormat.Binary,
    type: RulesetType.Remote,
  },
  {
    id: 'preset-telegram',
    tag: 'GeoSite-Telegram',
    labelKey: 'profileSimple.services.telegram',
    category: 'social',
    url: `${GEO_BASE}/geosite/telegram.srs`,
    format: RulesetFormat.Binary,
    type: RulesetType.Remote,
  },
  {
    id: 'preset-github',
    tag: 'GeoSite-GitHub',
    labelKey: 'profileSimple.services.github',
    category: 'dev',
    url: `${GEO_BASE}/geosite/github.srs`,
    format: RulesetFormat.Binary,
    type: RulesetType.Remote,
  },
  {
    id: 'preset-google',
    tag: 'GeoSite-Google',
    labelKey: 'profileSimple.services.google',
    category: 'dev',
    url: `${GEO_BASE}/geosite/google.srs`,
    format: RulesetFormat.Binary,
    type: RulesetType.Remote,
  },
  {
    id: 'preset-apple',
    tag: 'GeoSite-Apple',
    labelKey: 'profileSimple.services.apple',
    category: 'dev',
    url: `${GEO_BASE}/geosite/apple.srs`,
    format: RulesetFormat.Binary,
    type: RulesetType.Remote,
  },
  {
    id: 'preset-microsoft',
    tag: 'GeoSite-Microsoft',
    labelKey: 'profileSimple.services.microsoft',
    category: 'dev',
    url: `${GEO_BASE}/geosite/microsoft.srs`,
    format: RulesetFormat.Binary,
    type: RulesetType.Remote,
  },
  {
    id: 'preset-steam',
    tag: 'GeoSite-Steam',
    labelKey: 'profileSimple.services.steam',
    category: 'media',
    url: `${GEO_BASE}/geosite/steam.srs`,
    format: RulesetFormat.Binary,
    type: RulesetType.Remote,
  },
  {
    id: 'preset-ads',
    tag: 'Category-Ads',
    labelKey: 'profileSimple.services.ads',
    category: 'system',
    url: `${GEO_BASE}/geosite/category-ads-all.srs`,
    format: RulesetFormat.Binary,
    type: RulesetType.Remote,
  },
  {
    id: 'preset-geosite-cn',
    tag: 'GeoSite-CN',
    labelKey: 'profileSimple.services.cnDomain',
    category: 'region',
    url: `${GEO_BASE}/geosite/cn.srs`,
    format: RulesetFormat.Binary,
    type: RulesetType.Remote,
  },
  {
    id: 'preset-geoip-cn',
    tag: 'GeoIP-CN',
    labelKey: 'profileSimple.services.cnIp',
    category: 'region',
    url: `${GEO_BASE}/geoip/cn.srs`,
    format: RulesetFormat.Binary,
    type: RulesetType.Remote,
  },
  {
    id: 'preset-geolocation-not-cn',
    tag: 'GeoLocation-!CN',
    labelKey: 'profileSimple.services.overseas',
    category: 'region',
    url: `${GEO_BASE}/geosite/geolocation-!cn.srs`,
    format: RulesetFormat.Binary,
    type: RulesetType.Remote,
  },
]

export interface ProfilePresetMeta {
  value: App.ProfilePreset
  labelKey: string
  descKey: string
}

export const ProfilePresetOptions: ProfilePresetMeta[] = [
  {
    value: 'bypass-cn',
    labelKey: 'profileSimple.presets.bypassCn',
    descKey: 'profileSimple.presets.bypassCnDesc',
  },
  {
    value: 'proxy-list',
    labelKey: 'profileSimple.presets.proxyList',
    descKey: 'profileSimple.presets.proxyListDesc',
  },
  {
    value: 'global',
    labelKey: 'profileSimple.presets.global',
    descKey: 'profileSimple.presets.globalDesc',
  },
  {
    value: 'minimal',
    labelKey: 'profileSimple.presets.minimal',
    descKey: 'profileSimple.presets.minimalDesc',
  },
]
