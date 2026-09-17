import { auth } from '@/auth'
import { NextResponse } from 'next/server'

// Routes that don't require authentication.
//
// `/api/shuk-pedidos` la llama el servidor de Shuk Pedidos, que no tiene sesión
// de Google: sin esto se comería el redirect al login y el requerimiento nunca
// llegaría. No queda abierta: la ruta valida su propio secreto compartido.
const PUBLIC_PATHS = ['/login', '/api/auth', '/api/dux/forward', '/api/shuk-pedidos']

// En `next dev` (localhost) no se pide login de Google: agiliza probar cambios
// de UI sin depender de las credenciales OAuth.
// NODE_ENV es 'production' en el build de Vercel, así que operaciones.sohonc.ar
// SIEMPRE exige login. No reemplazar por una variable propia: esta la fija Next.
const SKIP_AUTH_EN_LOCAL = process.env.NODE_ENV === 'development'

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))
  const isLoggedIn = !!req.auth || SKIP_AUTH_EN_LOCAL

  if (!isPublic && !isLoggedIn) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
})

export const config = {
  // Run on all routes except static files and Next.js internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
