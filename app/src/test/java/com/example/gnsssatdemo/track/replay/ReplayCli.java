package com.example.gnsssatdemo.track.replay;

import java.io.File;
import java.io.PrintStream;

public class ReplayCli {
    public static void main(String[] args) throws Exception {
        int exitCode = run(args, System.out, System.err);
        if (exitCode != 0) {
            System.exit(exitCode);
        }
    }

    static int run(String[] args, PrintStream out, PrintStream err) throws Exception {
        if (args.length != 2) {
            err.println("Usage: ReplayCli <input-jsonl-dir> <output-report-dir>");
            return 2;
        }

        File inputDirectory = new File(args[0]);
        File outputDirectory = new File(args[1]);
        ReplayBatchResult result = new ReplayBatchRunner().run(inputDirectory, outputDirectory);

        out.println("Replay batch complete");
        out.println("input=" + inputDirectory.getAbsolutePath());
        out.println("output=" + outputDirectory.getAbsolutePath());
        out.println("total=" + result.items.size());
        out.println("exact=" + result.exactCount);
        out.println("bestEffort=" + result.bestEffortCount);
        out.println("invalidLog=" + result.invalidLogCount);
        return 0;
    }
}
