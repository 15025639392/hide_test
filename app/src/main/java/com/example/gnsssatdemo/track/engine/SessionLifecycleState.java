package com.example.gnsssatdemo.track.engine;

public class SessionLifecycleState {
    private boolean active;
    private boolean finished;
    private String integrityState = "OK";
    private String completionState = "ACTIVE";
    private String lastErrorCode = "";

    public void resetForStart() {
        active = false;
        finished = false;
        integrityState = "OK";
        completionState = "ACTIVE";
        lastErrorCode = "";
    }

    public void markActive() {
        active = true;
        finished = false;
        completionState = "ACTIVE";
    }

    public void markFinished() {
        active = false;
        finished = true;
        completionState = "FINISHED";
    }

    public void markInterrupted() {
        active = false;
        completionState = "INTERRUPTED";
    }

    public void markIntegrityError(String errorCode) {
        lastErrorCode = errorCode;
        integrityState = "ERROR";
        completionState = "ERROR";
        active = false;
    }

    public boolean isActive() {
        return active;
    }

    public boolean isFinished() {
        return finished;
    }

    public String getIntegrityState() {
        return integrityState;
    }

    public String getCompletionState() {
        return completionState;
    }

    public String getLastErrorCode() {
        return lastErrorCode;
    }
}
