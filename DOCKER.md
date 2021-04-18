# Run

need docker & docker-compose

docker-compose up -d

# Build

docker pull mcr.microsoft.com/dotnet/sdk:5.0

docker build -t homegenie:latest .


# simple test (will not be persisted)

docker run --rm -it -v /etc/localtime:/etc/localtime -p 80:80 homegenie:latest


more tests

docker run --rm -it -v /etc/localtime:/etc/localtime -p 80:80 homegenie:latest bash

then run with

cd /app/src/HomeGenie/ && dotnet run HomeGenie
