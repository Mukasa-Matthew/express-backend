import pool from '../config/database';
import { SemesterModel, SemesterEnrollmentModel } from '../models/Semester';
import { EmailService } from './emailService';

export class SemesterService {
  /**
   * Check and automatically end semesters that have passed their end date
   * Runs daily
   */
  static async checkAndEndSemesters(): Promise<void> {
    try {
      console.log('🔄 Checking for expired semesters...');

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find all active semesters that have passed their end date
      const expiredSemesters = await pool.query(
        `SELECT * FROM semesters 
         WHERE status = 'active' AND end_date < $1`,
        [today]
      );

      for (const semester of expiredSemesters.rows) {
        await this.endSemester(semester.id);
      }

      console.log('✅ Semester expiration check completed');
    } catch (error) {
      console.error('❌ Error checking semesters:', error);
    }
  }

  /**
   * End a semester: complete enrollments, notify students, etc.
   */
  private static async endSemester(semesterId: number): Promise<void> {
    try {
      console.log(`📅 Ending semester ${semesterId}...`);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Update semester status
        await SemesterModel.updateStatus(semesterId, 'completed');

        // Complete all active enrollments
        await client.query(
          `UPDATE semester_enrollments 
           SET enrollment_status = 'completed', completed_at = NOW(), updated_at = NOW()
           WHERE semester_id = $1 AND enrollment_status = 'active'`,
          [semesterId]
        );

        // Update room assignments to ended
        await client.query(
          `UPDATE student_room_assignments sra
           SET ended_at = NOW(), updated_at = NOW()
           FROM semester_enrollments se
           WHERE sra.semester_id = $1 AND se.semester_id = sra.semester_id AND se.user_id = sra.user_id
           AND se.enrollment_status = 'completed'`,
          [semesterId]
        );

        await client.query('COMMIT');
        console.log(`✅ Semester ${semesterId} ended successfully`);

        // Send notifications to students
        await this.sendSemesterEndNotifications(semesterId);

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error(`❌ Error ending semester ${semesterId}:`, error);
    }
  }

  /**
   * Send notifications to students about semester ending
   */
  private static async sendSemesterEndNotifications(semesterId: number): Promise<void> {
    try {
      // Get semester details
      const semester = await SemesterModel.findById(semesterId);
      if (!semester) return;

      // Get hostel info
      const hostelResult = await pool.query('SELECT name FROM hostels WHERE id = $1', [semester.hostel_id]);
      const hostelName = hostelResult.rows[0]?.name || 'Your Hostel';

      // Get all enrolled students
      const enrollments = await SemesterEnrollmentModel.findBySemester(semesterId);

      for (const enrollment of enrollments) {
        try {
          // Get student details
          const studentResult = await pool.query(
            'SELECT id, name, email FROM users WHERE id = $1',
            [enrollment.user_id]
          );

          if (studentResult.rows[0]) {
            const student = studentResult.rows[0];

            const emailHtml = EmailService.generateSemesterEndNotification(
              student.name,
              hostelName,
              semester.name,
              semester.academic_year,
              semester.end_date
            );

            await EmailService.sendEmail({
              to: student.email,
              subject: `📚 ${semester.name} - ${hostelName} Completed`,
              html: emailHtml
            });

            console.log(`📧 Sent semester end notification to ${student.email}`);
          }
        } catch (emailError) {
          console.error(`Failed to send email to student ${enrollment.user_id}:`, emailError);
        }
      }
    } catch (error) {
      console.error('Error sending semester end notifications:', error);
    }
  }

  /**
   * Send reminders for upcoming semester start
   */
  static async sendUpcomingSemesterReminders(): Promise<void> {
    try {
      console.log('🔄 Checking for upcoming semesters...');

      const today = new Date();
      const sevenDaysFromNow = new Date();
      sevenDaysFromNow.setDate(today.getDate() + 7);
      sevenDaysFromNow.setHours(0, 0, 0, 0);

      // Find semesters starting in 7 days
      const upcomingSemesters = await pool.query(
        `SELECT * FROM semesters 
         WHERE status = 'upcoming' 
         AND start_date BETWEEN $1 AND $2`,
        [today, sevenDaysFromNow]
      );

      for (const semester of upcomingSemesters.rows) {
        // Get hostel info
        const hostelResult = await pool.query('SELECT name FROM hostels WHERE id = $1', [semester.hostel_id]);
        const hostelName = hostelResult.rows[0]?.name || 'Your Hostel';

        // Get enrolled students for the upcoming semester
        const enrollments = await SemesterEnrollmentModel.findBySemester(semester.id);

        for (const enrollment of enrollments) {
          try {
            const studentResult = await pool.query(
              'SELECT id, name, email FROM users WHERE id = $1',
              [enrollment.user_id]
            );

            if (studentResult.rows[0]) {
              const student = studentResult.rows[0];
              const daysUntilStart = Math.ceil(
                (new Date(semester.start_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
              );

              const emailHtml = EmailService.generateUpcomingSemesterReminder(
                student.name,
                hostelName,
                semester.name,
                semester.academic_year,
                semester.start_date,
                daysUntilStart
              );

              await EmailService.sendEmail({
                to: student.email,
                subject: `⏰ ${semester.name} Starting in ${daysUntilStart} Days`,
                html: emailHtml
              });

              console.log(`📧 Sent upcoming semester reminder to ${student.email}`);
            }
          } catch (emailError) {
            console.error(`Failed to send email to student ${enrollment.user_id}:`, emailError);
          }
        }
      }

      console.log('✅ Upcoming semester reminders sent');
    } catch (error) {
      console.error('❌ Error sending upcoming semester reminders:', error);
    }
  }

  /**
   * Create a new semester based on the previous one (rollover)
   */
  static async rolloverSemester(
    oldSemesterId: number,
    newName: string,
    newAcademicYear: string,
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    try {
      const oldSemester = await SemesterModel.findById(oldSemesterId);
      if (!oldSemester) {
        throw new Error('Previous semester not found');
      }

      // Create new semester
      const newSemester = await SemesterModel.create({
        hostel_id: oldSemester.hostel_id,
        name: newName,
        academic_year: newAcademicYear,
        start_date: startDate,
        end_date: endDate
      });

      // Copy active enrollments from previous semester to new semester
      const oldEnrollments = await SemesterEnrollmentModel.findBySemester(oldSemesterId);
      
      for (const oldEnrollment of oldEnrollments) {
        if (oldEnrollment.enrollment_status === 'active') {
          // Check if student wants to continue (this could be configurable)
          // For now, automatically enroll them in the new semester
          await SemesterEnrollmentModel.enroll(
            newSemester.id,
            oldEnrollment.user_id,
            oldEnrollment.room_id
          );
        }
      }

      console.log(`✅ Rolled over semester ${oldSemesterId} to ${newSemester.id}`);
      return newSemester;
    } catch (error) {
      console.error('❌ Error rolling over semester:', error);
      throw error;
    }
  }
}

