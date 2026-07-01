import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base must match the GitHub repo name for project Pages (https://<user>.github.io/<repo>/)
export default defineConfig({
  plugins: [react()],
  base: '/prior-use-estimator/',
})
