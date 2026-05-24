import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AppShell } from './components/app-shell'
import { Toaster } from 'sonner'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'SOHO Retail OS',
  description: 'Sistema de gestión SOHO',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <AppShell>
          {children}
        </AppShell>
        <Toaster
          richColors
          position="bottom-right"
          toastOptions={{ style: { fontSize: '13px' } }}
        />
      </body>
    </html>
  )
}
