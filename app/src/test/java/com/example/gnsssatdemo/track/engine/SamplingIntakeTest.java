package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.RawPoint;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class SamplingIntakeTest {
    private static final long RECORD_START_NANOS = 1_000_000_000L;
    private static final long NOW_NANOS = 20_000_000_000L;
    private final SamplingEpoch epoch = new SamplingEpoch(1L, "MOVING",
            1000L, 0f, RECORD_START_NANOS);

    @Test
    public void missingEpoch_isSamplingContractViolation() {
        SamplingIntake.Result result = new SamplingIntake().accept(
                raw(1L, 2_000_000_000L), null, RECORD_START_NANOS, NOW_NANOS);

        assertFalse(result.accepted);
        assertTrue(result.contractViolation);
        assertEquals("sampling_contract_violation", result.reason);
    }

    @Test
    public void epochMismatch_isIntakeRejection() {
        SamplingEpoch lateEpoch = new SamplingEpoch(2L, "MOVING",
                1000L, 0f, 10_000_000_000L);

        SamplingIntake.Result result = new SamplingIntake().accept(
                raw(1L, 2_000_000_000L), lateEpoch, RECORD_START_NANOS, NOW_NANOS);

        assertFalse(result.accepted);
        assertFalse(result.contractViolation);
        assertEquals("sampling_epoch_mismatch", result.reason);
    }

    @Test
    public void duplicateAndOutOfOrderFixesAreRejectedBeforeTrustDecision() {
        SamplingIntake intake = new SamplingIntake();

        assertTrue(intake.accept(raw(1L, 2_000_000_000L), epoch,
                RECORD_START_NANOS, NOW_NANOS).accepted);
        assertEquals("duplicate_fix", intake.accept(raw(1L, 2_000_000_000L), epoch,
                RECORD_START_NANOS, NOW_NANOS).reason);
        assertEquals("out_of_order_fix", intake.accept(raw(2L, 1_900_000_000L), epoch,
                RECORD_START_NANOS, NOW_NANOS).reason);
    }

    @Test
    public void callbackMustUseCapturedEpochInsteadOfLatestEpoch() {
        SamplingEpoch capturedEpoch = new SamplingEpoch(1L, "MOVING",
                1000L, 0f, RECORD_START_NANOS);
        SamplingEpoch newerEpoch = new SamplingEpoch(2L, "SIGNAL_WEAK",
                2000L, 0f, 10_000_000_000L);
        RawPoint oldRequestFix = raw(1L, 2_000_000_000L);

        assertTrue(new SamplingIntake().accept(oldRequestFix, capturedEpoch,
                RECORD_START_NANOS, NOW_NANOS).accepted);
        assertEquals("sampling_epoch_mismatch", new SamplingIntake().accept(oldRequestFix,
                newerEpoch, RECORD_START_NANOS, NOW_NANOS).reason);
    }

    private RawPoint raw(long id, long elapsedRealtimeNanos) {
        return new RawPoint(id, "gps", 29.0, 106.0,
                false, 0.0, true, 5f,
                false, 0f, false, 0f, 1L,
                true, elapsedRealtimeNanos, false);
    }
}
