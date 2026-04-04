import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Pilot Pay Tracker',
  description: 'Track your pilot pay with ease',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        {children}
      </body>
    </html>
  )
}
