'use client'

import { useState, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { ShoppingBag, AlertCircle, Loader2 } from 'lucide-react'

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function LoginContent() {
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const searchParams            = useSearchParams()
  const callbackUrl             = searchParams.get('callbackUrl') ?? '/compras'
  const authError               = searchParams.get('error')

  const handleGoogleLogin = async () => {
    setLoading(true)
    setError('')
    try {
      await signIn('google', { callbackUrl })
    } catch {
      setError('Error al iniciar sesión. Intentá de nuevo.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-xl shadow-gray-200/60 overflow-hidden">

          {/* Header */}
          <div className="px-8 pt-8 pb-6 text-center border-b border-gray-100">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/30">
              <ShoppingBag size={22} className="text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">SOHO Retail OS</h1>
            <p className="text-sm text-gray-500 mt-1">Sistema de gestión de dietéticas</p>
          </div>

          {/* Body */}
          <div className="px-8 py-6 space-y-4">

            {/* Auth error */}
            {(authError || error) && (
              <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <p className="text-sm leading-snug">
                  {authError === 'AccessDenied'
                    ? 'Tu cuenta no tiene acceso autorizado al sistema. Contactá al administrador.'
                    : error || 'Error de autenticación.'}
                </p>
              </div>
            )}

            <p className="text-sm text-gray-500 text-center">
              Iniciá sesión con tu cuenta de Google institucional
            </p>

            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 h-11 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all duration-150 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin text-gray-400" />
              ) : (
                <GoogleIcon />
              )}
              {loading ? 'Conectando...' : 'Continuar con Google'}
            </button>

          </div>

          {/* Footer */}
          <div className="px-8 py-4 border-t border-gray-100 bg-slate-50/60">
            <p className="text-[11px] text-gray-400 text-center leading-relaxed">
              Solo cuentas autorizadas por el administrador pueden acceder.
              El acceso queda registrado.
            </p>
          </div>

        </div>

        <p className="text-center text-[11px] text-gray-400 mt-4">
          v2.0 · SOHO Shuk SRL · {new Date().getFullYear()}
        </p>

      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}
