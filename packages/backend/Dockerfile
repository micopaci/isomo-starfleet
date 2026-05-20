FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
# Note: Since this is part of a workspace, we copy just this package's dependencies
# and install them locally for the container.
COPY package.json ./
RUN npm install --omit=dev

# Copy the rest of the backend source code
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Start the application (runs migrations then server)
CMD ["npm", "start"]
