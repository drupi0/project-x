FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl cmake g++ make \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSL https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.8.3.tar.gz | tar xz --strip-components=1
RUN cmake -B build -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DWHISPER_BUILD_TESTS=OFF -DBUILD_SHARED_LIBS=OFF \
    && cmake --build build --config Release --target whisper-server -j 2

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o 10001 -g 10001 /models
COPY --from=build /src/build/bin/whisper-server /usr/local/bin/whisper-server
COPY download-model.sh /usr/local/bin/download-model
USER 10001:10001
WORKDIR /tmp
CMD ["whisper-server", "--host", "0.0.0.0", "--port", "8080", "--model", "/models/ggml-tiny.bin", "--language", "auto", "--no-gpu"]
