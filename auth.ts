import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'

// Authorized email whitelist — only these addresses can log in
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase() ?? ''
      // If no whitelist configured, deny all (fail safe)
      if (ALLOWED_EMAILS.length === 0) return false
      return ALLOWED_EMAILS.includes(email)
    },

    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub
      }
      return session
    },

    async jwt({ token, account, profile }) {
      if (account) {
        token.accessToken = account.access_token
      }
      return token
    },
  },

  pages: {
    signIn:  '/login',
    error:   '/login',
  },

  session: {
    strategy: 'jwt',
    maxAge:   30 * 24 * 60 * 60, // 30 days
  },
})
