package com.examgrid.solver;

import com.examgrid.solver.batch.BatchRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Two ways to run:
 * <pre>
 *   java -jar examgrid-solver.jar                         # REST API on :8002
 *   java -jar examgrid-solver.jar batch DATA_DIR OUT_DIR  # plan a whole exam cycle from files
 * </pre>
 */
@SpringBootApplication
public class SolverApplication {

    public static void main(String[] args) throws Exception {
        if (args.length > 0 && args[0].equals("batch")) {
            System.exit(BatchRunner.run(args));
        }
        SpringApplication.run(SolverApplication.class, args);
    }
}
