# typed: false
# frozen_string_literal: true

require "spec_helper"
require "dependabot/npm_and_yarn/pnpm_lockfile_document"

RSpec.describe Dependabot::NpmAndYarn::PnpmLockfileDocument do
  let(:engine_document) do
    {
      "lockfileVersion" => "9.0",
      "importers" => { "." => { "dependencies" => { "etag" => { "specifier" => "^1.0.0", "version" => "1.8.0" } } } },
      "packages" => { "etag@1.8.0" => { "resolution" => { "integrity" => "sha512-etag==" } } },
      "snapshots" => { "etag@1.8.0" => {} }
    }
  end

  before do
    described_class.clear_cache
    allow(Dependabot::SharedHelpers).to receive(:run_helper_subprocess)
      .with(
        command: Dependabot::NpmAndYarn::NativeHelpers.helper_path,
        function: "pnpm:readLockfileDocument",
        args: [kind_of(String)]
      )
      .and_return(engine_document)
  end

  after { described_class.clear_cache }

  describe ".read" do
    it "reads a v9 lockfile with pnpm's engine" do
      expect(described_class.read("lockfileVersion: '9.0'\n")).to eq(engine_document)
    end

    it "reads a v13 lockfile with pnpm's engine" do
      content = "{\n\t\"lockfileVersion\": \"13.0\",\n\t\"projects\": {},\n}\n"

      expect(described_class.read(content)).to eq(engine_document)
    end

    it "writes the lockfile into the directory it passes to the helper" do
      content = "lockfileVersion: '9.0'\n"
      written = nil
      allow(Dependabot::SharedHelpers).to receive(:run_helper_subprocess) do |args:, **|
        written = File.read(File.join(args.first, "pnpm-lock.yaml"))
        engine_document
      end

      described_class.read(content)

      expect(written).to eq(content)
    end

    it "parses a v6 lockfile as YAML without the helper" do
      content = <<~YAML
        lockfileVersion: '6.0'

        packages:

          /etag@1.8.0:
            resolution: {integrity: sha512-etag==}
      YAML

      expect(described_class.read(content)).to eq(
        "lockfileVersion" => "6.0",
        "packages" => { "/etag@1.8.0" => { "resolution" => { "integrity" => "sha512-etag==" } } }
      )
      expect(Dependabot::SharedHelpers).not_to have_received(:run_helper_subprocess)
    end

    it "parses a v5.4 lockfile as YAML without the helper" do
      expect(described_class.read("lockfileVersion: 5.4\n")).to eq("lockfileVersion" => 5.4)
      expect(Dependabot::SharedHelpers).not_to have_received(:run_helper_subprocess)
    end

    it "returns an empty document for empty content without the helper" do
      expect(described_class.read("")).to eq({})
      expect(Dependabot::SharedHelpers).not_to have_received(:run_helper_subprocess)
    end

    it "returns an empty document when the helper finds no lockfile" do
      allow(Dependabot::SharedHelpers).to receive(:run_helper_subprocess).and_return(nil)

      expect(described_class.read("lockfileVersion: '9.0'\n")).to eq({})
    end

    it "reads the same content once" do
      content = "lockfileVersion: '9.0'\n"

      3.times { described_class.read(content) }

      expect(Dependabot::SharedHelpers).to have_received(:run_helper_subprocess).once
    end

    it "keeps only the most recently read documents" do
      contents = (0..described_class::CACHE_SIZE).map { |i| "lockfileVersion: '9.0'\n# #{i}\n" }

      contents.each { |content| described_class.read(content) }
      described_class.read(contents.first)

      expect(Dependabot::SharedHelpers).to have_received(:run_helper_subprocess)
        .exactly(described_class::CACHE_SIZE + 2).times
    end

    it "raises a parse error when pnpm cannot read the lockfile" do
      allow(Dependabot::SharedHelpers).to receive(:run_helper_subprocess)
        .and_raise(
          Dependabot::SharedHelpers::HelperSubprocessFailed.new(
            message: "The lockfileVersion of 6.0 is incompatible with this version of pnpm",
            error_context: {}
          )
        )

      expect { described_class.read("lockfileVersion: '9.0'\n") }
        .to raise_error(Dependabot::DependencyFileNotParseable) do |error|
          expect(error.file_path).to eq("pnpm-lock.yaml")
          expect(error.message).to include("incompatible with this version of pnpm")
        end
    end
  end
end
