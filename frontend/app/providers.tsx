// app/providers.tsx — NEW v4.0.0 (Blueprint §4.2)
// Centralized providers: Theme (next-themes)
'use client'

import { ThemeProvider } from 'next-themes'

interface ProvidersProps {
  children: React.ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider
      attribute="class"              // Tambahkan class "dark" ke <html> element
      defaultTheme="light"           // Default: light mode
      enableSystem={true}            // Hormati preferensi OS user
      disableTransitionOnChange={false}
    >
      {children}
    </ThemeProvider>
  )
}
