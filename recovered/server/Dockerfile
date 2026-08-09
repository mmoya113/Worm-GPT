FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY index.mjs ./
ENV NODE_ENV=production
EXPOSE 8787
CMD ["npm","start"]
