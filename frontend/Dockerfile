FROM node:20-alpine
WORKDIR /app
COPY package.json vite.config.js index.html server.js ./
RUN npm install
COPY src ./src
RUN npm run build
EXPOSE 5173
CMD ["npm", "start"]
