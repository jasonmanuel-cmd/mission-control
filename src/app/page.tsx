'use client'

import { useState, useEffect } from 'react'
import {
  Cpu,
  Activity,
  Key,
  User,
  ChevronDown,
  Globe,
  Plus,
  X,
  LayoutDashboard,
  Layers
} from 'lucide-react'
import AllSitesOverview from '@/components/AllSitesOverview'
import TriageBoard from '@/components/TriageBoard'
import NotificationBell from '@/components/NotificationBell'
import ApiKeyManager from '@/components/ApiKeyManager'
import { SiteConfig } from '@/lib/siteConfig'

// Lazy-loaded detail view cards
import dynamic from 'next/dynamic'
const SecurityMalwareCard = dynamic(() => import('@/components/SecurityMalwareCard'), { ssr: false })
const PerformanceCard = dynamic(() => import('@/components/PerformanceCard'), { ssr: false })
const UptimeCard = dynamic(() => import('@/components/UptimeCard'), { ssr: false })
const AIWatchdogCard = dynamic(() => import('@/components/AIWatchdogCard'), { ssr: false })
const SEOGEOAEOCard = dynamic(() => import('@/components/SEOGEOAEOCard'), { ssr: false })
const AIFixRecommendations = dynamic(() => import('@/components/AIFixRecommendations'), { ssr: false })
const AnalyticsOverview = dynamic(() => import('@/components/AnalyticsOverview'), { ssr: false })
const SSLCard = dynamic(() => import('@/components/SSLCard'), { ssr: false })

// Client-only time display to prevent hydration mismatch
function ClientTime() {
  const [time, setTime] = useState<string>('')

  useEffect(() => {
    setTime(new Date().toLocaleString())
    const interval = setInterval(() => {
      setTime(new Date().toLocaleString())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  if (!time) return <span>Loading...</span>
  return <span>{time}</span>
}

export default function Dashboard() {
  const [sites, setSites] = useState<SiteConfig[]>([])
  const [selectedSite, setSelectedSite] = useState<SiteConfig | null>(null)
  const [sitesError, setSitesError] = useState<string | null>(null)
  const [showApiKeys, setShowApiKeys] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [viewMode, setViewMode] = useState<'overview' | 'detail'>('overview')

  // Prevent hydration mismatch + load the site registry from /api/sites
  useEffect(() => {
    setMounted(true)
    fetch('/api/sites')
      .then(async res => {
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
        setSites(body as SiteConfig[])
      })
      .catch(err => setSitesError(String(err?.message ?? err)))
  }, [])

  const handleSiteClick = (siteId: string) => {
    const site = sites.find(s => s.id === siteId)
    if (site) {
      setSelectedSite(site)
      setViewMode('detail')
    }
  }

  const handleBackToOverview = () => {
    setSelectedSite(null)
    setViewMode('overview')
  }

  const mainContent = sitesError ? (
    <div className="rounded-xl border border-cyber-red/50 bg-cyber-red/10 p-6 text-cyber-red">
      <h2 className="text-lg font-semibold mb-1">Could not load sites</h2>
      <p className="text-sm font-mono">{sitesError}</p>
    </div>
  ) : viewMode === 'overview' ? (
    <>
      <TriageBoard onSiteClick={handleSiteClick} />
      <AllSitesOverview onSiteClick={handleSiteClick} userSites={sites} />
    </>
  ) : selectedSite ? (
    <div>
      {/* Back Button & Site Title */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={handleBackToOverview}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyber-gray border border-cyber-border
                   text-gray-400 hover:text-white hover:border-neon-purple-500/50 transition-colors"
        >
          <Layers className="w-4 h-4" />
          Back to All Sites
        </button>
        <div>
          <h2 className="text-2xl font-bold text-white">{selectedSite.name}</h2>
          <p className="text-sm text-gray-500">{selectedSite.url}</p>
        </div>
      </div>

      {/* Detail Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 xl:grid-cols-6 gap-4 auto-rows-min">
        {/* Security & Malware Card */}
        <div className="lg:col-span-2 lg:row-span-2">
          <SecurityMalwareCard siteId={selectedSite.id} siteName={selectedSite.name} />
        </div>

        {/* Uptime Card */}
        <div className="lg:col-span-2">
          <UptimeCard
            siteId={selectedSite.id}
            siteName={selectedSite.name}
            siteUrl={selectedSite.url}
          />
        </div>

        {/* AI Watchdog Card */}
        <div className="lg:col-span-2 lg:row-span-2">
          <AIWatchdogCard
            repository={selectedSite.githubRepo}
            currentGenTime={2000}
          />
        </div>

        {/* Performance Card */}
        <div className="lg:col-span-2 xl:col-span-4">
          <PerformanceCard siteId={selectedSite.id} url={selectedSite.url} />
        </div>

        {/* Analytics Overview */}
        <div className="lg:col-span-3">
          <AnalyticsOverview siteId={selectedSite.id} />
        </div>

        {/* SSL Card */}
        <div className="lg:col-span-1">
          <SSLCard hostname={selectedSite.url.replace(/^https?:\/\//, '').replace(/\/$/, '')} />
        </div>

        {/* SEO/GEO/AEO Analytics Card */}
        <div className="lg:col-span-3">
          <SEOGEOAEOCard
            siteId={selectedSite.id}
            siteUrl={selectedSite.url}
          />
        </div>

        {/* AI Fix Recommendations Card */}
        <div className="lg:col-span-3">
          <AIFixRecommendations
            siteId={selectedSite.id}
            siteName={selectedSite.name}
            siteUrl={selectedSite.url}
          />
        </div>
      </div>
    </div>
  ) : null

  if (!mounted) {
    return (
      <div className="min-h-screen bg-cyber-black flex items-center justify-center">
        <div className="text-center animate-fade-in">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-neon-purple-500 border-t-transparent animate-spin-slow" />
          <div className="text-neon-purple-500 text-xl font-mono">Loading Command Center...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cyber-black">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-cyber-dark/80 backdrop-blur-lg border-b border-cyber-border">
        <div className="max-w-[1920px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Logo & Title */}
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-gradient-cyber animate-spin-slow-20">
                <Cpu className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white flex items-center gap-2">
                  Chaotically Organized AI
                  <span className="px-2 py-0.5 text-xs font-mono rounded bg-neon-purple-500/20 text-neon-purple-500 border border-neon-purple-500/30">
                    COMMAND CENTER
                  </span>
                </h1>
                <p className="text-xs text-gray-500">
                  Real-time monitoring for all your websites
                </p>
              </div>
            </div>

            {/* View Toggle */}
            <div className="flex items-center gap-2 bg-cyber-gray rounded-lg p-1 border border-cyber-border">
              <button
                onClick={handleBackToOverview}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  viewMode === 'overview'
                    ? 'bg-neon-purple-500 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Layers className="w-4 h-4" />
                All Sites
              </button>
              <button
                onClick={() => selectedSite && setViewMode('detail')}
                disabled={!selectedSite}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                  viewMode === 'detail'
                    ? 'bg-neon-purple-500 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                Detail View
              </button>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              {/* Sites Count */}
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neon-purple-500/10 border border-neon-purple-500/30">
                <Globe className="w-4 h-4 text-neon-purple-500" />
                <span className="text-xs font-medium text-neon-purple-500">{sites.length} Sites</span>
              </div>

              {/* Notifications */}
              <NotificationBell />

              {/* API Keys */}
              <button
                onClick={() => setShowApiKeys(true)}
                className="p-2 rounded-lg hover:bg-cyber-gray transition-colors"
                title="API Keys"
              >
                <Key className="w-5 h-5 text-gray-400" />
              </button>


              {/* User Menu */}
              <button className="flex items-center gap-2 p-2 rounded-lg hover:bg-cyber-gray transition-colors">
                <div className="w-8 h-8 rounded-full bg-gradient-cyber flex items-center justify-center">
                  <User className="w-4 h-4 text-white" />
                </div>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Status Bar */}
      <div className="bg-cyber-dark border-b border-cyber-border">
        <div className="max-w-[1920px] mx-auto px-6 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-electric-green-500 animate-pulse" />
                <span className="text-xs text-electric-green-500 font-medium">Live Monitoring Active</span>
              </div>
              <span className="text-xs text-gray-500">|</span>
              <span className="text-xs text-gray-500">
                Monitoring {sites.length} websites across Netlify
              </span>
            </div>
            <div className="text-xs text-gray-500">
              <ClientTime />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-[1920px] mx-auto px-6 py-6">
        {mainContent}

      {/* Footer */}
      <footer className="mt-8 pt-6 border-t border-cyber-border">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <div className="flex items-center gap-4">
              <span>Chaotically Organized AI Command Center v1.0.0</span>
              <span>|</span>
              <span>Production Ready</span>
              <span>|</span>
              <span>{sites.length} Sites Monitored</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-neon-purple-500 font-medium">Powered by Chaotically Organized AI</span>
            </div>
          </div>
        </footer>
      </main>


      {/* API Key Manager Modal */}
      {showApiKeys && (
        <ApiKeyManager onClose={() => setShowApiKeys(false)} />
      )}
    </div>
  )
}
