# Use Node 18 Alpine
FROM node:24-alpine

# Set working directory
WORKDIR /app

# Install build tools
RUN apk add --no-cache git python3 make g++ openssl bash

# Copy package.json & package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the app
COPY . .

# Install bower components (allow root)
RUN if [ -f bower.json ]; then npm run bowerdeps || echo "No bower.json, skipping"; fi

# Expose the port WildDuck Webmail uses
EXPOSE 3000
CMD ["node", "server.js", "--config=/app/config/default.toml"]