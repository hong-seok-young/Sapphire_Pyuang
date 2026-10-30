package com.floatingclock.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.Calendar

/** 위키 재부활 글 읽기와 보스·네임드 목록 만들기 */
class WikiTimersTest {

    private fun sec(text: String): Int? = WikiTimers.parseRespawn(text)?.sec

    private fun hms(h: Int, m: Int = 0, s: Int = 0) = h * 3600 + m * 60 + s

    @Test
    fun simpleDurations() {
        assertEquals(30, sec("30초"))
        assertEquals(hms(0, 58, 20), sec("58분 20초"))
        assertEquals(hms(0, 65, 20), sec("65분 20초"))
        assertEquals(hms(72), sec("72시간"))
        assertEquals(hms(24, 15), sec("24시간 15분"))
        assertEquals(hms(15), sec("15시간?"))
    }

    @Test
    fun decreasingBossesUseTheLastValue() {
        assertEquals(hms(2, 30), sec("2시간 50분 2시간 40분 2시간 30분 (고정)"))
        assertEquals(hms(0, 25), sec("30분 → 25분"))
        assertEquals(hms(5, 33), sec("5시간 43분 ↓ 5시간 33분"))
        assertEquals(hms(5, 33), sec("1회:6시간50분 2회:6시간30분 3회:6시간10분 4회:5시간50분 이후:5시간33분 (고정)"))
        assertEquals(
            hms(61, 30),
            sec("1회:68시간30분 2회:65시간00분 3회:61시간30분 (3:30 무한감소) 2회차부터 오차 ±0~60분"),
        )
    }

    @Test
    fun errorMarginIsNotCounted() {
        assertEquals(hms(0, 58, 20), sec("58분 20초 (오차 ±10초)"))
    }

    @Test
    fun fixedClockTimes() {
        val r = WikiTimers.parseRespawn("11:00, 23:00 (1시간 유지)")
        assertNotNull(r)
        assertNull(r!!.sec)
        assertEquals(listOf(11 * 60, 23 * 60), r.times)
    }

    @Test
    fun noTimeMeansNoTimer() {
        assertNull(WikiTimers.parseRespawn("-"))
        assertNull(WikiTimers.parseRespawn("제단 활성화 (몬스터 처치)"))
        assertNull(WikiTimers.parseRespawn("재점령 시"))
    }

    @Test
    fun durationTimerEndsAfterTheRespawnTime() {
        val mob = WikiTimers.Mob("탱크@1", "탱크", 33, hms(0, 58, 20), null, null)
        assertEquals(1_000_000L + hms(0, 58, 20) * 1000L, mob.nextAt(1_000_000L))
    }

    @Test
    fun fixedTimeTimerEndsAtTheNextSpawn() {
        val mob = WikiTimers.Mob("부크샤@1", "부크샤", 51, null, listOf(11 * 60, 23 * 60), null)
        val noon = Calendar.getInstance().apply {
            set(2026, Calendar.OCTOBER, 30, 12, 0, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val a = Calendar.getInstance().apply { timeInMillis = mob.nextAt(noon.timeInMillis)!! }
        assertEquals(30, a.get(Calendar.DAY_OF_MONTH))
        assertEquals(23, a.get(Calendar.HOUR_OF_DAY))
        assertEquals(0, a.get(Calendar.MINUTE))

        val late = (noon.clone() as Calendar).apply { set(Calendar.HOUR_OF_DAY, 23); set(Calendar.MINUTE, 30) }
        val b = Calendar.getInstance().apply { timeInMillis = mob.nextAt(late.timeInMillis)!! }
        assertEquals(31, b.get(Calendar.DAY_OF_MONTH))
        assertEquals(11, b.get(Calendar.HOUR_OF_DAY))
    }

    /** 실제 위키 자료로 확인한다. 자료는 공개 저장소에 없으므로 -PwikiDataDir=폴더 를 줄 때만 돈다 */
    @Test
    fun buildsTheListFromWikiData() {
        val path = System.getProperty("wikiDataDir").orEmpty()
        assumeTrue("wikiDataDir not given", path.isNotEmpty() && File(path).isDirectory)
        val texts = listOf("regions", "places", "monsters", "meta").associateWith {
            File(path, "$it.json").readText(Charsets.UTF_8)
        }
        val data = WikiTimers.build(texts)
        assertNotNull(data)
        data!!
        println("wiki places=${data.places.size} mobs=${data.mobCount} source=${data.sourceTitle}/${data.author}/${data.patch}")
        assertTrue(data.places.isNotEmpty())
        for (place in data.places) {
            assertTrue(place.region, !place.region.contains("삭제"))
            for (m in place.mobs) {
                assertTrue("${place.name} ${m.name}", m.times != null || (m.sec ?: 0) >= 600)
            }
        }
        val east = data.places.first { it.name == "하늘성채 동부" }
        assertEquals(hms(0, 58, 20), east.mobs.first { it.name == "탱크" }.sec)
        assertEquals(hms(2, 30), east.mobs.first { it.name == "정령여왕" }.sec)
        assertNotNull(east.mobs.first { it.name == "정령여왕" }.note)
        val library = data.places.first { it.name == "금서고" }
        assertEquals(listOf(11 * 60, 23 * 60), library.mobs.first { it.name == "부크샤" }.times)
    }
}
