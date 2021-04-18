FROM mcr.microsoft.com/dotnet/sdk:5.0

RUN apt-get update && apt-get install -y libusb-1.0

COPY / /app/

RUN ln -s /usr/share/dotnet/shared/Microsoft.NETCore.App/${DOTNET_VERSION} /dotnetcore

RUN cd /app/src/SupportLibraries/NetClientLib/ && dotnet build --configuration Release

RUN cd /app/src/HomeGenie/ && dotnet build --configuration Release

RUN cp ./lib/x86_64-linux-gnu/libusb-1.0.so.0 /app/src/HomeGenie/bin/Release/netcoreapp5/

CMD cd /app/src/HomeGenie/bin/Release/netcoreapp5 && ./HomeGenie 

