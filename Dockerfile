FROM mcr.microsoft.com/dotnet/sdk:5.0

COPY src/ /app/src

RUN cd /app/src/SupportLibraries/NetClientLib/ && dotnet build

RUN cd /app/src/HomeGenie/ && dotnet build

CMD cd /app/src/HomeGenie/ && dotnet run HomeGenie

