FROM ghcr.io/dependabot/dependabot-updater-core
ARG TARGETARCH

USER root

# Install Go
ARG GOLANG_VERSION=1.19.5
# You can find the sha here: https://storage.googleapis.com/golang/go${GOLANG_VERSION}.linux-amd64.tar.gz.sha256
ARG GOLANG_AMD64_CHECKSUM=36519702ae2fd573c9869461990ae550c8c0d955cd28d2827a6b159fda81ff95
ARG GOLANG_ARM64_CHECKSUM=fc0aa29c933cec8d76f5435d859aaf42249aa08c74eb2d154689ae44c08d23b3

ENV PATH=/opt/go/bin:$PATH
RUN cd /tmp \
  && curl --http1.1 -o go-${TARGETARCH}.tar.gz https://dl.google.com/go/go${GOLANG_VERSION}.linux-${TARGETARCH}.tar.gz \
  && printf "$GOLANG_AMD64_CHECKSUM go-amd64.tar.gz\n$GOLANG_ARM64_CHECKSUM go-arm64.tar.gz\n" | sha256sum -c --ignore-missing - \
  && tar -xzf go-${TARGETARCH}.tar.gz -C /opt \
  && rm go-${TARGETARCH}.tar.gz

ENV DEPENDABOT_NATIVE_HELPERS_PATH="/opt"

COPY go_modules/helpers /opt/go_modules/helpers
RUN bash /opt/go_modules/helpers/build

USER dependabot
COPY --chown=dependabot:dependabot go_modules /home/dependabot/go_modules
