 // components/ui/theme-toggle.tsx — NEW v4.0.0 (Blueprint §4.6)
// Toggle button Light/Dark mode using lucide-react icons
'use client'

import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Wajib: hindari hydration mismatch
  // Komponen ini hanya boleh render setelah mount di client
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0)
    return () => clearTimeout(timer)
  }, [])
  if (!mounted) return <div className="w-8 h-8" />

  const isDark = theme === 'dark'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex items-center justify-center w-8 h-8 rounded-lg
                 text-healy-slate hover:text-healy-sage hover:bg-healy-bg-alt
                 transition-all duration-150 cursor-pointer"
    >
      {isDark
        ? <Sun className="w-4.5 h-4.5" />
        : <Moon className="w-4.5 h-4.5" />
      }
    </button>
  )
}
