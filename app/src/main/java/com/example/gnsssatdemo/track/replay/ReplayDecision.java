package com.example.gnsssatdemo.track.replay;

public class ReplayDecision {
    public final long lineNumber;
    public final long rawPointId;
    public final String actualResult;
    public final String actualReason;
    public final String expectedResult;
    public final String expectedReason;

    public ReplayDecision(long lineNumber, long rawPointId,
                          String actualResult, String actualReason,
                          String expectedResult, String expectedReason) {
        this.lineNumber = lineNumber;
        this.rawPointId = rawPointId;
        this.actualResult = actualResult;
        this.actualReason = actualReason;
        this.expectedResult = expectedResult;
        this.expectedReason = expectedReason;
    }

    public boolean hasExpectation() {
        return expectedResult != null || expectedReason != null;
    }

    public boolean matchesExpectation() {
        if (!hasExpectation()) {
            return true;
        }
        boolean resultMatches = expectedResult == null || expectedResult.equals(actualResult);
        boolean reasonMatches = expectedReason == null || expectedReason.equals(actualReason);
        return resultMatches && reasonMatches;
    }
}
