# CleanSpot web app (website + PWA) as a static site behind nginx.
# The VITE_* values are baked into the build: pass them as build arguments.
#
#   docker build -f deploy/docker/Dockerfile \
#     --build-arg VITE_SUPABASE_URL=https://api.example.org \
#     --build-arg VITE_SUPABASE_ANON_KEY=<anon key> \
#     -t cleanspot-web .

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Playwright browsers and the Supabase CLI binary are not needed for the build.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --ignore-scripts
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
ARG VITE_GEOCODER_PROVIDER=nominatim
ARG VITE_GEOCODER_URL=https://nominatim.openstreetmap.org
ARG VITE_GEOCODER_COUNTRYCODES=de
ARG VITE_PLAY_STORE_URL=
# Never enable demo mode for a real installation (the demo password would be public).
ARG VITE_DEMO_MODE=false
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_ANON_KEY" \
  || (echo "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY build args are required" && exit 1)
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
