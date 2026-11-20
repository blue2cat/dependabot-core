# typed: strict
# frozen_string_literal: true

require "digest"
require "tmpdir"
require "yaml"
require "sorbet-runtime"
require "dependabot/errors"
require "dependabot/shared_helpers"
require "dependabot/npm_and_yarn/helpers"
require "dependabot/npm_and_yarn/native_helpers"

module Dependabot
  module NpmAndYarn
    # The `importers`, `packages` and `snapshots` sections of a pnpm lockfile.
    #
    # pnpm's own engine reads lockfiles from 9.x on, through the native helper:
    # it drops a leading env document and converts the v13 format to the v9
    # sections. Older lockfiles (5.4, 6.x) are parsed as YAML, since the engine
    # cannot read them and they never carry an env document.
    #
    # Documents are cached by content, because callers compare the same original
    # and updated lockfiles once per dependency.
    module PnpmLockfileDocument
      extend T::Sig

      ENGINE_LOCKFILE_MAJORS = T.let([9, 12, 13].freeze, T::Array[Integer])
      CACHE_SIZE = 8
      LOCKFILE_NAME = "pnpm-lock.yaml"

      @cache = T.let({}, T::Hash[String, T::Hash[String, T.untyped]])

      sig { params(content: String).returns(T::Hash[String, T.untyped]) }
      def self.read(content)
        key = Digest::SHA256.hexdigest(content)
        document = @cache.delete(key) || parse_content(content)
        @cache[key] = document
        @cache.shift while @cache.size > CACHE_SIZE
        document
      end

      sig { void }
      def self.clear_cache
        @cache.clear
      end

      sig { params(content: String).returns(T::Hash[String, T.untyped]) }
      def self.parse_content(content)
        return {} if content.strip.empty?

        version = Helpers.pnpm_lockfile_version_in(content)
        return yaml_document(content) if version && !ENGINE_LOCKFILE_MAJORS.include?(version.to_i)

        engine_document(content)
      end
      private_class_method :parse_content

      sig { params(content: String).returns(T::Hash[String, T.untyped]) }
      def self.yaml_document(content)
        document = YAML.safe_load_stream(content).last
        document.is_a?(Hash) ? document : {}
      end
      private_class_method :yaml_document

      sig { params(content: String).returns(T::Hash[String, T.untyped]) }
      def self.engine_document(content)
        Dir.mktmpdir("dependabot-pnpm-lockfile") do |dir|
          File.write(File.join(dir, LOCKFILE_NAME), content)
          document = SharedHelpers.run_helper_subprocess(
            command: NativeHelpers.helper_path,
            function: "pnpm:readLockfileDocument",
            args: [dir]
          )
          document.is_a?(Hash) ? document : {}
        end
      rescue SharedHelpers::HelperSubprocessFailed => e
        raise Dependabot::DependencyFileNotParseable.new(LOCKFILE_NAME, e.message)
      end
      private_class_method :engine_document
    end
  end
end
