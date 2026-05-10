FROM python:3.11-slim

# Install ffmpeg (required for audio/video processing)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY . .

# Create directories for runtime data
RUN mkdir -p /data/output /data/thumbnails /data/sprites /data/work /data/db

# Expose port
EXPOSE 5200

# Run with uvicorn
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5200"]
