# Development Dockerfile for People Manager CRM
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for development mode)
RUN npm ci

# Copy all source code
COPY . .

# Expose port 5000
EXPOSE 5000

# Start the development server
CMD ["npm", "run", "dev"]
